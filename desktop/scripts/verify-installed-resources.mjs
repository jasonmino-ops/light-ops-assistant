#!/usr/bin/env node

import { access } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { verifyProviderArtifact } from './provider-artifact.mjs'

const PROVIDER_COMMIT = '7785be145d5259991038d17839d322e2694e338c'
const resources = resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('usage: verify-installed-resources.mjs <resources-directory>')

const appAsar = join(resources, 'app.asar')
await access(appAsar)
const require = createRequire(import.meta.url)
const { listPackage } = require('@electron/asar')
const normalizeAsarPath = (entry) => entry.replaceAll('\\', '/').replace(/^\/+/, '')
const packaged = new Set(listPackage(appAsar).map(normalizeAsarPath))
const requiredDesktopEntries = [
  'dist/main/main.js',
  'dist/main/printing/v3PrintingRuntime.js',
  'dist/main/printing/printerSetupService.js',
  'dist/main/printing/freshV3Bootstrap.js',
  'dist/preload/printingSetupPreload.js',
  'dist/renderer/printingSetup/index.html',
  'dist/renderer/printingSetup/printingSetup.css',
  'dist/renderer/printingSetup/printingSetupRenderer.js',
  'package.json',
]
for (const entry of requiredDesktopEntries) {
  if (!packaged.has(entry)) throw new Error(`Installed Desktop resource missing from app.asar: ${entry}`)
}

const provider = await verifyProviderArtifact(join(resources, 'eshop-windows-provider'), PROVIDER_COMMIT)
console.log(JSON.stringify({
  result: 'PASS',
  resources,
  desktopEntries: requiredDesktopEntries.length,
  provider,
}, null, 2))
