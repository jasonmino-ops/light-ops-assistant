import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const required = [
  'dist/preload/activationPreload.js',
  'dist/renderer/activation/index.html',
  'dist/renderer/activation/activation.css',
  'dist/renderer/activation/activationRenderer.js',
]

function normalizeAsarPath(value) {
  return value.replace(/\\/g, '/').replace(/^\/+/, '')
}

const mode = process.argv[2] ?? 'dist'

if (mode === 'dist') {
  await Promise.all(required.map((file) => access(resolve(file))))
  console.log('activation assets: PASS')
} else if (mode === 'asar' || mode.endsWith('.asar')) {
  const archive = mode === 'asar' ? process.argv[3] : mode
  if (!archive) throw new Error('missing asar path')
  const require = createRequire(import.meta.url)
  const asar = require('@electron/asar')
  const files = new Set(asar.listPackage(resolve(archive)).map(normalizeAsarPath))
  for (const file of required) {
    if (!files.has(normalizeAsarPath(file))) throw new Error(`missing packaged activation asset: ${file}`)
  }
  console.log('packaged activation assets: PASS')
} else {
  throw new Error(`unknown mode: ${mode}`)
}
