import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const mainPath = resolve('dist/main/main.js')
let source = await readFile(mainPath, 'utf8')

function replaceOnce(from, to, label) {
  const first = source.indexOf(from)
  if (first < 0 || source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`staging dist overlay failed: ${label}`)
  }
  source = source.replace(from, to)
}

replaceOnce(
  "const config = (0, config_1.loadConfig)(electron_1.app.getPath('userData'));",
  "const config = (0, config_1.loadConfig)(electron_1.app.getPath('userData'), { resourcesPath: process.resourcesPath, appName: electron_1.app.getName() });",
  'runtime build profile',
)
replaceOnce(
  'onClosedBeforeAuthorization: () => { void quitApp(); },\n        });',
  'onClosedBeforeAuthorization: () => { void quitApp(); },\n            buildChannel: config.buildChannel,\n        });',
  'activation STAGING marker',
)

await writeFile(mainPath, source)
console.log('staging dist overlay: PASS')
