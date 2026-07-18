import { copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const assetGroups = [
  {
    name: 'activation',
    sourceDir: resolve('src/renderer/activation'),
    targetDir: resolve('dist/renderer/activation'),
    files: ['index.html', 'activation.css'],
  },
  {
    name: 'deployment-error',
    sourceDir: resolve('src/renderer/deployment-error'),
    targetDir: resolve('dist/renderer/deployment-error'),
    files: ['index.html', 'deployment.css'],
  },
  {
    name: 'customer-fallback',
    sourceDir: resolve('src/renderer/customer-fallback'),
    targetDir: resolve('dist/renderer/customer-fallback'),
    files: ['index.html', 'customerFallback.css'],
  },
]

for (const group of assetGroups) {
  await mkdir(group.targetDir, { recursive: true })
  await Promise.all(group.files.map((file) => copyFile(resolve(group.sourceDir, file), resolve(group.targetDir, file))))
}
