import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { beforeAll, describe, expect, it } from 'vitest'
import { computeStatus } from '../src/core/status'
import { install } from '../src/core/actions'
import { makeFake, writePackage, makeCa } from './helpers/fakeEnv'
import type { Status } from '../src/core/types'

const root = join(__dirname, '..')
const rendererJs = join(root, 'dist', 'renderer', 'renderer.js')
const indexHtml = join(root, 'src', 'renderer', 'index.html')

/**
 * 用真实 index.html 里的 id 列表构造一个最小 DOM，跑编译产物 renderer.js。
 * 目的不是替代真机，而是保证 renderer 引用的每个 id 都真实存在、
 * 四种状态都能渲染出正确的标题和样式类。
 */
type Stub = { textContent: string; className: string; disabled: boolean; children: Stub[] }

function idsFromHtml(): string[] {
  const html = readFileSync(indexHtml, 'utf8')
  return [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
}

function makeDom(ids: string[]) {
  const nodes = new Map<string, Stub>()
  const el = (): Stub => ({ textContent: '', className: '', disabled: false, children: [] })
  for (const id of ids) nodes.set(id, el())

  const missing: string[] = []
  const document = {
    getElementById(id: string) {
      const node = nodes.get(id)
      if (!node) { missing.push(id); return null }
      return {
        get textContent() { return node.textContent },
        set textContent(v: string) { node.textContent = v; node.children.length = 0 },
        get className() { return node.className },
        set className(v: string) { node.className = v },
        get disabled() { return node.disabled },
        set disabled(v: boolean) { node.disabled = v },
        addEventListener() { /* 事件绑定在本测试中不触发 */ },
        append(...kids: Stub[]) { node.children.push(...kids) },
      }
    },
    createElement() {
      const node = el()
      return Object.assign(node, { append: (...k: Stub[]) => node.children.push(...k) })
    },
  }
  return { nodes, document, missing }
}

async function render(status: Status) {
  const ids = idsFromHtml()
  const dom = makeDom(ids)
  const bridge = {
    status: async () => status,
    log: async () => ['2026-08-03T10:00:00.000Z [install] ok'],
    install: async () => { throw new Error('not used') },
    update: async () => { throw new Error('not used') },
    repair: async () => { throw new Error('not used') },
    uninstall: async () => null,
    openLogFolder: async () => undefined,
  }
  const ctx = createContext({ document: dom.document, window: { certManager: bridge }, console })
  runInContext(readFileSync(rendererJs, 'utf8'), ctx)
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setImmediate(r))
  return dom
}

describe('渲染层', () => {
  beforeAll(() => {
    if (!existsSync(rendererJs)) {
      execFileSync('npm', ['run', 'compile'], { cwd: root, stdio: 'pipe' })
    }
  })

  it('index.html 提供了 renderer 需要的全部 id', async () => {
    const fake = makeFake()
    const dom = await render(computeStatus(fake.env))
    expect(dom.missing).toEqual([])
    fake.cleanup()
  })

  it('四种状态都渲染出对应的标题与样式类', async () => {
    const cases: Array<[() => Status, string, string]> = [
      [() => { const f = makeFake(); const s = computeStatus(f.env); f.cleanup(); return s }, '未安装', 'state-NOT_INSTALLED'],
      [() => {
        const f = makeFake(); install(f.env); const s = computeStatus(f.env); f.cleanup(); return s
      }, '正常', 'state-OK'],
      [() => {
        const f = makeFake({ packageVersion: 1 }); install(f.env)
        writePackage(f.env.packageDir, makeCa(2).pem, 2)
        const s = computeStatus(f.env); f.cleanup(); return s
      }, '需要更新', 'state-NEEDS_UPDATE'],
      [() => { const f = makeFake({ qzInstalled: false }); const s = computeStatus(f.env); f.cleanup(); return s },
        '配置异常', 'state-MISCONFIGURED'],
    ]

    for (const [build, headline, className] of cases) {
      const dom = await render(build())
      expect(dom.nodes.get('status-text')?.textContent).toBe(headline)
      expect(dom.nodes.get('status-card')?.className).toContain(className)
    }
  })

  it('未安装时禁用更新/修复，安装可用', async () => {
    const fake = makeFake()
    const dom = await render(computeStatus(fake.env))
    expect(dom.nodes.get('btn-install')?.disabled).toBe(false)
    expect(dom.nodes.get('btn-update')?.disabled).toBe(true)
    expect(dom.nodes.get('btn-repair')?.disabled).toBe(true)
    fake.cleanup()
  })

  it('QZ 未安装时四个按钮都不可点，并说明原因', async () => {
    const fake = makeFake({ qzInstalled: false })
    const dom = await render(computeStatus(fake.env))
    for (const id of ['btn-install', 'btn-update', 'btn-repair', 'btn-uninstall']) {
      expect(dom.nodes.get(id)?.disabled).toBe(true)
    }
    expect(dom.nodes.get('status-note')?.textContent).toContain('配置')
    fake.cleanup()
  })
})
