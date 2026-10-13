import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, rename } from 'node:fs/promises'
import path from 'node:path'
import type { ClaimTokenProtector } from '../src/executionJournal'
import { exactObject } from '../src/networkContract'

export const sealedHash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const transactionName = /^cold-transaction-(\d{5})-([0-9a-f-]{36})$/
type Original = { name: string; sha256: string }
type Intent = { schemaVersion: 1; id: string; profileSha256: string; nextProfileSha256: string; originals: Original[] }

/** Only configuration transactions live here. No job is interpreted, replayed,
 * removed or ACKed. All original encrypted bytes and journal bytes are retained. */
export class ColdModeTransaction {
  constructor(private readonly directory: string, private readonly protector: ClaimTokenProtector) {}

  async names() {
    const names = (await readdir(this.directory)).filter(name => name.startsWith('cold-transaction-')).sort()
    if (names.length > 10000 || names.some(name => !transactionName.test(name))) throw new Error('ADDON_COLD_TRANSACTION_BLOCKED')
    return names
  }

  async nextId() {
    const names = await this.names()
    const ordinal = names.length ? Number(transactionName.exec(names[names.length - 1])![1]) + 1 : 1
    if (ordinal > 10000) throw new Error('ADDON_COLD_TRANSACTION_BLOCKED')
    return `cold-transaction-${String(ordinal).padStart(5, '0')}-${randomUUID()}`
  }

  async readRegular(file: string, maximum = 2 * 1024 * 1024): Promise<string> {
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) throw new Error('ADDON_COLD_TRANSACTION_BLOCKED')
    return readFile(file, 'utf8')
  }

  async syncDirectory(directory: string) {
    if (process.platform === 'win32') return // Windows has no supported directory fsync through Node.
    const handle = await open(directory, 'r')
    try { await handle.sync() } finally { await handle.close() }
  }

  async syncFile(file: string) {
    const handle = await open(file, 'r+')
    try { await handle.sync() } finally { await handle.close() }
  }

  private async writeNew(file: string, contents: string) {
    const handle = await open(file, 'wx', 0o600)
    try { await handle.writeFile(contents, 'utf8'); await handle.sync() } finally { await handle.close() }
  }

  private async replaceProfile(contents: string) {
    const file = path.join(this.directory, 'profile.sealed')
    const temporary = `${file}.${randomUUID()}.tmp`
    await this.writeNew(temporary, contents)
    await rename(temporary, file)
    await this.syncFile(file)
    await this.syncDirectory(this.directory)
  }

  private parseIntent(raw: string, id: string): Intent {
    const value = exactObject(JSON.parse(this.protector.unprotect(raw)), ['schemaVersion', 'id', 'profileSha256', 'nextProfileSha256', 'originals'])
    if (value.schemaVersion !== 1 || value.id !== id || !Array.isArray(value.originals)
      || value.originals.length < 1 || value.originals.length > 3
      || ![value.profileSha256, value.nextProfileSha256].every(hash => typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash))) {
      throw new Error('ADDON_COLD_TRANSACTION_BLOCKED')
    }
    const originals = value.originals.map(item => {
      const original = exactObject(item, ['name', 'sha256'])
      if (typeof original.name !== 'string' || !/^(profile\.sealed|nodes-\d{1,5}\.sealed|execution-journal\.json)$/.test(original.name)
        || typeof original.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(original.sha256)) throw new Error('ADDON_COLD_TRANSACTION_BLOCKED')
      return { name: original.name, sha256: original.sha256 }
    })
    if (originals[0].name !== 'profile.sealed' || originals[0].sha256 !== value.profileSha256
      || new Set(originals.map(item => item.name)).size !== originals.length) throw new Error('ADDON_COLD_TRANSACTION_BLOCKED')
    return { schemaVersion: 1, id, profileSha256: String(value.profileSha256), nextProfileSha256: String(value.nextProfileSha256), originals }
  }

  async original(id: string, name: string): Promise<string> {
    if (!transactionName.test(id) || !/^(profile\.sealed|nodes-\d{1,5}\.sealed|execution-journal\.json)$/.test(name)) throw new Error('ADDON_COLD_PROVENANCE_INVALID')
    return this.readRegular(path.join(this.directory, id, `${name}.original`))
  }

  private async decide(id: string, intent: string, outcome: 'COMMITTED' | 'ROLLED_BACK') {
    const directory = path.join(this.directory, id)
    const staged = path.join(directory, `decision-${randomUUID()}.tmp`)
    const bytes = this.protector.protect(JSON.stringify({ schemaVersion: 1, intentSha256: sealedHash(intent), outcome }))
    await this.writeNew(staged, bytes)
    await this.syncDirectory(directory)
    await this.syncDirectory(this.directory)
    // The last operation is the atomic authority switch, after every required
    // content/directory barrier above. No failing fsync follows publication.
    // A crash that loses this rename leaves an undecided transaction, which
    // restores the original. This is not proof that the application observed
    // completion and does not claim whole-machine power-loss verification.
    await rename(staged, path.join(directory, 'decision.sealed'))
  }

  async recover(): Promise<boolean> {
    let expected: string | undefined
    let recovered = false
    const names = await this.names()
    for (const [index, id] of names.entries()) {
      const directory = path.join(this.directory, id)
      const info = await lstat(directory)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('ADDON_COLD_TRANSACTION_BLOCKED')
      const raw = await this.readRegular(path.join(directory, 'intent.sealed'), 32768)
      const intent = this.parseIntent(raw, id)
      if (expected && expected !== intent.profileSha256) throw new Error('ADDON_COLD_TRANSACTION_BLOCKED')
      for (const original of intent.originals) {
        if (sealedHash(await this.original(id, original.name)) !== original.sha256) throw new Error('ADDON_COLD_TRANSACTION_BLOCKED')
      }
      let outcome: string
      try {
        const decision = exactObject(JSON.parse(this.protector.unprotect(await this.readRegular(path.join(directory, 'decision.sealed'), 32768))),
          ['schemaVersion', 'intentSha256', 'outcome'])
        if (decision.schemaVersion !== 1 || decision.intentSha256 !== sealedHash(raw)
          || !['COMMITTED', 'ROLLED_BACK'].includes(String(decision.outcome))) throw new Error('ADDON_COLD_TRANSACTION_BLOCKED')
        // A visible selector is not evidence that its final publication was
        // durable. Finish that barrier before trusting any selected profile.
        await this.syncFile(path.join(directory, 'decision.sealed'))
        await this.syncDirectory(directory)
        outcome = String(decision.outcome)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || index !== names.length - 1) throw error
        // Never complete a pending commit on restart, even if new profile bytes
        // are visible. Durable original bytes are the sole recovery authority.
        await this.replaceProfile(await this.original(id, 'profile.sealed'))
        await this.decide(id, raw, 'ROLLED_BACK')
        outcome = 'ROLLED_BACK'
        recovered = true
      }
      expected = outcome === 'COMMITTED' ? intent.nextProfileSha256 : intent.profileSha256
      if (index === names.length - 1 && outcome === 'ROLLED_BACK') recovered = true
    }
    if (expected && sealedHash(await this.readRegular(path.join(this.directory, 'profile.sealed'), 32768)) !== expected) throw new Error('ADDON_COLD_TRANSACTION_BLOCKED')
    if (expected) {
      await this.syncFile(path.join(this.directory, 'profile.sealed'))
      await this.syncDirectory(this.directory)
    }
    return recovered
  }

  async commit(input: { id: string; originalFiles: string[]; nextProfile: string; prepare: () => Promise<void> }) {
    if (!transactionName.test(input.id)) throw new Error('ADDON_COLD_TRANSACTION_BLOCKED')
    const directory = path.join(this.directory, input.id)
    const originalProfile = await this.readRegular(path.join(this.directory, 'profile.sealed'), 32768)
    let intentRaw: string | undefined
    try {
      await mkdir(directory, { mode: 0o700 })
      const originals: Original[] = []
      for (const name of ['profile.sealed', ...input.originalFiles]) {
        const bytes = await this.readRegular(path.join(this.directory, name))
        await this.writeNew(path.join(directory, `${name}.original`), bytes)
        originals.push({ name, sha256: sealedHash(bytes) })
      }
      intentRaw = this.protector.protect(JSON.stringify({ schemaVersion: 1, id: input.id,
        profileSha256: sealedHash(originalProfile), nextProfileSha256: sealedHash(input.nextProfile), originals } satisfies Intent))
      this.parseIntent(intentRaw, input.id)
      await this.writeNew(path.join(directory, 'intent.sealed'), intentRaw)
      await this.syncDirectory(directory)
      await this.syncDirectory(this.directory)
      await input.prepare()
      await this.replaceProfile(input.nextProfile)
      await this.decide(input.id, intentRaw, 'COMMITTED')
    } catch (cause) {
      // Even a rename followed by failed target fsync must restore original
      // bytes. If restoring/syncing fails, the undecided intent blocks restart.
      if (intentRaw) {
        try {
          await this.replaceProfile(originalProfile)
          await this.decide(input.id, intentRaw, 'ROLLED_BACK')
        } catch (recoveryCause) {
          throw new Error('ADDON_COLD_TRANSACTION_BLOCKED', { cause: new AggregateError([cause, recoveryCause]) })
        }
      }
      throw cause
    }
  }
}
