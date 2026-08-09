import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { FileSetupCheckpointStore } from './checkpoint'
import type { MerchantBindingStatus } from './contracts'
import { EShopSetupOrchestrator } from './orchestrator'
import { createPhase1Adapters } from './phase1Adapters'
import { JsonLinesSetupLogger } from './setupLog'

function argument(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null
}

function bindingStatus(): MerchantBindingStatus {
  const value = argument('--binding-status') ?? 'NOT_BOUND'
  if (value === 'NOT_BOUND' || value === 'WAITING' || value === 'VALID' || value === 'INVALID') return value
  throw new Error(`invalid --binding-status: ${value}`)
}

function defaultStateDir(): string {
  if (process.platform === 'win32' && process.env.ProgramData) {
    return join(process.env.ProgramData, 'E-Shop', 'Setup')
  }
  return join(tmpdir(), 'eshop-v1-setup')
}

async function main(): Promise<void> {
  const stateDir = resolve(argument('--state-dir') ?? defaultStateDir())
  const orchestrator = new EShopSetupOrchestrator(
    createPhase1Adapters(),
    new FileSetupCheckpointStore(join(stateDir, 'setup-checkpoint-v1.json')),
    new JsonLinesSetupLogger(join(stateDir, 'setup.log.jsonl')),
  )
  const result = await orchestrator.run(bindingStatus())
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.state === 'BLOCKED') process.exitCode = 2
}

void main().catch((error) => {
  process.stderr.write(`E-Shop V1 Setup failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
  process.exitCode = 1
})
