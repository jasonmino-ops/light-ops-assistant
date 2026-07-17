import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const required = [
  'dist/preload/activationPreload.js',
  'dist/renderer/activation/index.html',
  'dist/renderer/activation/activation.css',
  'dist/renderer/activation/activationRenderer.js',
]

const mode = process.argv[2] ?? 'dist'

if (mode === 'dist') {
  await Promise.all(required.map((file) => access(resolve(file))))
  console.log('activation assets: PASS')
} else if (mode === 'asar') {
  const archive = process.argv[3]
  if (!archive) throw new Error('missing asar path')
  const require = createRequire(import.meta.url)
  const asar = require('@electron/asar')
  const files = new Set(asar.listPackage(resolve(archive)))
  for (const file of required) {
    if (!files.has(`/${file}`)) throw new Error(`missing packaged activation asset: ${file}`)
  }
  console.log('packaged activation assets: PASS')
} else {
  throw new Error(`unknown mode: ${mode}`)
}
