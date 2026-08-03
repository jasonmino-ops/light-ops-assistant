// tsc 只输出 .ts 的编译结果，index.html / renderer.css 需要单独复制到 dist。
import { copyFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'src', 'renderer')
const dest = join(root, 'dist', 'renderer')

mkdirSync(dest, { recursive: true })
for (const file of ['index.html', 'renderer.css']) {
  copyFileSync(join(src, file), join(dest, file))
}
console.log('[copy-renderer] index.html, renderer.css -> dist/renderer')
