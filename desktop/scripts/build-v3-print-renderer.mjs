import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(desktop, '..')
const require = createRequire(path.join(root, 'package.json'))
const { build } = require('esbuild')
const output = path.join(desktop, 'dist/main/printing')
await mkdir(output, { recursive: true })
await build({ absWorkingDir: root, entryPoints: [path.join(root, 'e-shop-tray/src/networkRenderPreload.tsx')],
  outfile: path.join(output, 'v3-network-render.cjs'), bundle: true, platform: 'browser', format: 'cjs', target: 'chrome152',
  sourcemap: false, logLevel: 'silent', external: ['electron'], tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', baseUrl: root, paths: { '@/*': ['./*'] } } },
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.ES_TRAY_BUILD_PROFILE': '"network-v2"' } })
await writeFile(path.join(output, 'v3-network-render.html'), '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data: blob:; frame-src \'self\' about:; font-src \'self\'; connect-src \'none\'"></head><body></body></html>\n')
