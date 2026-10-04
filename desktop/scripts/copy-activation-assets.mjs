import { copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const assets = [
  ['activation', ['index.html', 'activation.css']],
  ['printingSetup', ['index.html', 'printingSetup.css']],
]

await Promise.all(assets.map(async ([directory, files]) => {
  const sourceDir = resolve('src/renderer', directory)
  const targetDir = resolve('dist/renderer', directory)
  await mkdir(targetDir, { recursive: true })
  await Promise.all(files.map((file) => copyFile(resolve(sourceDir, file), resolve(targetDir, file))))
}))
