import { copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const sourceDir = resolve('src/renderer/activation')
const targetDir = resolve('dist/renderer/activation')

await mkdir(targetDir, { recursive: true })
await Promise.all([
  copyFile(resolve(sourceDir, 'index.html'), resolve(targetDir, 'index.html')),
  copyFile(resolve(sourceDir, 'activation.css'), resolve(targetDir, 'activation.css')),
])
