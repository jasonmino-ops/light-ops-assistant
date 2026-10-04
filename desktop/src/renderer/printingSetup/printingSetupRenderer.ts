type Role = 'FRONT' | 'KITCHEN'
type Candidate = { id: string; ip: string; port: number; hardwareAddress: string; interfaceName: string }
type Endpoint = { host: string; port: number; hardwareAddress?: string }
type Snapshot = {
  state: 'NEEDS_SETUP' | 'DISCOVERING' | 'CONFIGURING' | 'READY' | 'ERROR'
  version: string
  candidates: Candidate[]
  assignments: Record<Role, string | null>
  tested: Record<Role, boolean>
  configured: Partial<Record<Role, Endpoint>>
  readiness: Record<Role, boolean>
  errorCode: string | null
  busy: boolean
}
type Result = { ok: boolean; error?: string; state?: Snapshot }
type Api = {
  getState(): Promise<Result>
  discover(): Promise<Result>
  assign(role: Role, candidateId: string): Promise<Result>
  test(role: Role): Promise<Result>
  save(): Promise<Result>
  close(): Promise<Result>
  onStateChanged(callback: (state: Snapshot) => void): () => void
}
interface Window { eshopPrinterSetup: Api }

const get = <T extends HTMLElement>(id: string): T => {
  const value = document.getElementById(id)
  if (!value) throw new Error(`missing printer setup element: ${id}`)
  return value as T
}
const discoverButton = get<HTMLButtonElement>('discover')
const saveButton = get<HTMLButtonElement>('save')
const closeButton = get<HTMLButtonElement>('close')
const selects: Record<Role, HTMLSelectElement> = {
  FRONT: get<HTMLSelectElement>('front-select'),
  KITCHEN: get<HTMLSelectElement>('kitchen-select'),
}
const testButtons: Record<Role, HTMLButtonElement> = {
  FRONT: get<HTMLButtonElement>('front-test'),
  KITCHEN: get<HTMLButtonElement>('kitchen-test'),
}
const testStates: Record<Role, HTMLElement> = {
  FRONT: get('front-test-state'),
  KITCHEN: get('kitchen-test-state'),
}

function endpointText(endpoint?: Endpoint): string {
  if (!endpoint) return '未配置'
  return `${endpoint.host}:${endpoint.port} · MAC ${endpoint.hardwareAddress ?? '未记录'}`
}

function statusView(state: Snapshot): { title: string; detail: string; tone: string } {
  if (state.state === 'READY') return { title: 'Ready for Business', detail: 'FRONT 与 KITCHEN 已保存且当前可连接，重启后会继续使用加密绑定。', tone: 'ready' }
  if (state.state === 'DISCOVERING') return { title: '正在扫描局域网', detail: '扫描最多需要约 45 秒，请保持打印机开机并连接同一网络。', tone: '' }
  if (state.state === 'ERROR') return { title: '需要处理后重试', detail: `状态：${state.errorCode ?? 'PRINTER_SETUP_FAILED'}`, tone: 'error' }
  return { title: '等待完成打印设置', detail: state.errorCode ? `状态：${state.errorCode}` : '请依次扫描、分配、测试并保存。', tone: '' }
}

function option(candidate: Candidate): HTMLOptionElement {
  const node = document.createElement('option')
  node.value = candidate.id
  node.textContent = `${candidate.ip}:${candidate.port} · ${candidate.hardwareAddress}`
  return node
}

function render(state: Snapshot): void {
  get('version').textContent = `v${state.version}`
  const currentStatus = statusView(state)
  get('status-title').textContent = currentStatus.title
  get('status-detail').textContent = currentStatus.detail
  get('status-dot').className = `dot ${currentStatus.tone}`.trim()

  const list = get('candidate-list')
  list.replaceChildren(...state.candidates.map((candidate) => {
    const card = document.createElement('article')
    card.className = 'candidate'
    const address = document.createElement('strong')
    address.textContent = `${candidate.ip}:${candidate.port}`
    const mac = document.createElement('span')
    mac.textContent = `MAC ${candidate.hardwareAddress}`
    const adapter = document.createElement('span')
    adapter.textContent = `网络：${candidate.interfaceName}`
    card.append(address, mac, adapter)
    return card
  }))
  get('candidate-empty').hidden = state.candidates.length > 0

  for (const role of ['FRONT', 'KITCHEN'] as const) {
    const select = selects[role]
    select.replaceChildren(new Option('请选择打印机', ''), ...state.candidates.map(option))
    select.value = state.assignments[role] ?? ''
    select.disabled = state.busy || state.candidates.length === 0
    testButtons[role].disabled = state.busy || !state.assignments[role]
    testStates[role].textContent = state.tested[role] ? '测试通过' : '未测试'
    testStates[role].className = state.tested[role] ? 'badge ok' : 'badge'
  }
  get('saved-bindings').textContent = `FRONT：${endpointText(state.configured.FRONT)}\nKITCHEN：${endpointText(state.configured.KITCHEN)}`
  ;(get('saved-bindings') as HTMLElement).style.whiteSpace = 'pre-line'
  discoverButton.disabled = state.busy
  saveButton.disabled = state.busy || !state.tested.FRONT || !state.tested.KITCHEN
  saveButton.textContent = state.state === 'READY' ? '已保存 · Ready' : '保存并检查 Ready'
}

async function invoke(action: () => Promise<Result>): Promise<void> {
  const result = await action()
  if (result.state) render(result.state)
}

discoverButton.addEventListener('click', () => { void invoke(() => window.eshopPrinterSetup.discover()) })
closeButton.addEventListener('click', () => { void window.eshopPrinterSetup.close() })
saveButton.addEventListener('click', () => { void invoke(() => window.eshopPrinterSetup.save()) })
for (const role of ['FRONT', 'KITCHEN'] as const) {
  selects[role].addEventListener('change', () => { void invoke(() => window.eshopPrinterSetup.assign(role, selects[role].value)) })
  testButtons[role].addEventListener('click', () => { void invoke(() => window.eshopPrinterSetup.test(role)) })
}
window.eshopPrinterSetup.onStateChanged(render)
void invoke(() => window.eshopPrinterSetup.getState())
