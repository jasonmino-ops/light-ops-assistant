type Status = { version: string; server: string; storeCode: string | null; ready: boolean; busy: boolean; code: string;
  mode: string | null; enabled: boolean; endpoint: { host: string; port: number } | null; revision: number;
  test: { id: string; outcome: string; endpoint: { host: string; port: number }; bytes: number; sha256: string } | null;
  lastEvent: { event: string; jobId?: string; resultCode?: string; effectBoundary?: string } | null; autostart: boolean }
declare global { interface Window { networkAddon: { invoke(action: string, value?: unknown): Promise<{ ok: boolean; value?: unknown; code?: string }> } } }
export {}
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const input = (id: string) => el<HTMLInputElement>(id)
let current: Status | undefined
let busy = false
const messages: Record<string, string> = {
  RUNNING: '已启用。等待门店网络打印任务；任务由服务器持久保存。',
  PAUSED: '已暂停领取，当前交付已结束。配置和 journal 保持不变。',
  SETUP_OR_PAUSED: '请选择设备并确认 TEST 纸票，再启用。',
  CONFIGURED_PAUSED: '配置已保存。确认单 Agent 约束后启用。',
  TEST_AWAITING_PHYSICAL_CONFIRMATION: '测试字节已提交。请核对实体纸票；不会自动重发。',
  DESKTOP_BINDING_IDENTITY_UNAVAILABLE: '请先安装原 Desktop 0.4.7 并完成门店绑定，再重新读取。',
  DESKTOP_BINDING_NOT_ACTIVE: '请在 Desktop 完成有效门店绑定。本程序不会修改原身份。',
  ADDON_CHROME_REQUIRED: '请安装 Google Chrome 后重试打开收银入口。',
  ADDON_TEST_REVIEW_REQUIRED: '上次 TEST 尚未确认或结果不确定。请核对纸票，不要反复发送。',
  NETWORK_UNCERTAIN_EFFECT_REQUIRES_REVIEW: '存在不确定打印结果。已停止自动交付，请记录任务并由负责人核对；不会重打。',
  ADDON_INITIALIZATION_INCOMPLETE_OR_PROFILE_LOST: '本机持久状态缺失或初始化曾中断，已安全停止。请保留目录，联系支持；不要清空重装。',
  ADDON_SINGLE_AGENT_CONFIRMATION_REQUIRED: '请先确认本店没有其他 Network Agent 在领取任务。',
  NETWORK_CHANGED: '网络已变化。保持暂停，重新发现并主动确认原打印机。',
  ADDON_PAUSE_REQUIRED: '请先暂停，等待当前任务安全结束。',
  ADDON_MODE_LOCKED: '本期不支持切换已配置模式。请保留原配置并联系支持。',
}
function message(code: string) { return messages[code] ?? '操作未完成或打印异常。请保留下面的错误代码并核对网络、绑定和原订单；不要重新提交销售补票。' }
async function invoke(action: string, value: unknown = {}) {
  const result = await window.networkAddon.invoke(action, value)
  if (!result.ok) throw new Error(result.code ?? 'ADDON_OPERATION_FAILED')
  return result.value
}
function render(state: Status) {
  current = state
  el('store').textContent = state.storeCode ? `绑定门店 · ${state.storeCode}` : '等待 Desktop 门店绑定'
  el('pill').textContent = state.enabled && state.code === 'RUNNING' ? 'NETWORK 已启用' : '设置 / 需要注意'
  el('status-message').textContent = message(state.code)
  el('version').textContent = `v${state.version} · ${state.server}`
  el('diagnostic').textContent = [state.code, state.lastEvent?.jobId, state.lastEvent?.resultCode, state.lastEvent?.effectBoundary].filter(Boolean).join(' · ')
  el('configured-endpoint').textContent = state.endpoint ? `已确认端点：${state.endpoint.host}:${state.endpoint.port} · 配置修订 ${state.revision}` : '尚未确认任何打印设备'
  for (const radio of Array.from(document.querySelectorAll<HTMLInputElement>('input[name=mode]'))) {
    radio.disabled = !!state.mode || busy
    if (state.mode) radio.checked = radio.value === state.mode
  }
  input('autostart').checked = state.autostart
  const testPending = !!state.test && ['INTENT', 'SUBMITTED', 'UNKNOWN'].includes(state.test.outcome)
  const canConfigure = state.ready && !state.enabled && !busy
  el<HTMLButtonElement>('discover').disabled = !canConfigure
  el<HTMLButtonElement>('test').disabled = !canConfigure || testPending || !input('test-ready').checked
  el<HTMLButtonElement>('pause').disabled = !state.ready || busy
  el<HTMLButtonElement>('retry-binding').disabled = state.ready || busy
  el<HTMLButtonElement>('enable').disabled = !state.ready || state.enabled || !state.revision || busy || state.test?.outcome !== 'CONFIRMED' || !input('single-agent').checked
  el<HTMLButtonElement>('cashier').disabled = !state.enabled || busy || state.code !== 'RUNNING'
  el<HTMLButtonElement>('confirm').disabled = busy || !input('paper-confirmed').checked || (state.revision > 0 && !input('same-printer').checked)
  input('host').disabled = !canConfigure || testPending
  input('port').disabled = !canConfigure || testPending
  el('confirmation').hidden = state.test?.outcome !== 'SUBMITTED'
  el('same-printer-row').hidden = state.revision === 0
  if (state.test) el('test-summary').textContent = `TEST ${state.test.id} → ${state.test.endpoint.host}:${state.test.endpoint.port} · ${state.test.bytes} bytes · SHA-256 ${state.test.sha256}。TCP 不是实体出票证明。`
}
async function refresh() {
  try { render(await invoke('status') as Status) } catch { el('status-message').textContent = '无法读取状态。请安全退出后重启；不会自动补打。' }
}
async function act(action: string, data: unknown = {}) {
  if (busy) return
  busy = true
  if (current) render(current)
  try { return await invoke(action, data) }
  catch (error) { el('status-message').textContent = message(error instanceof Error ? error.message : ''); el('diagnostic').textContent = error instanceof Error ? error.message : '' }
  finally { busy = false; await refresh() }
}
for (const id of ['test-ready', 'paper-confirmed', 'single-agent', 'same-printer']) input(id).addEventListener('change', () => { if (current) render(current) })
el('retry-binding').addEventListener('click', () => { void act('retryBinding') })
el('pause').addEventListener('click', () => { void act('pause') })
el('enable').addEventListener('click', () => { void act('enable', { singleAgentConfirmed: input('single-agent').checked }) })
el('cashier').addEventListener('click', () => { void act('cashier') })
input('autostart').addEventListener('change', () => { void act('autostart', { enabled: input('autostart').checked }) })
el('cancel').addEventListener('click', () => { void invoke('cancelDiscovery') })
el('discover').addEventListener('click', async () => {
  el('cancel').hidden = false
  const list = el('candidates'); list.replaceChildren()
  const result = await act('discover') as { candidates: { host: string; port: number }[]; status: string; reason?: string } | undefined
  el('cancel').hidden = true
  if (!result) return
  if (!result.candidates.length) { const note = document.createElement('p'); note.className = 'note'; note.textContent = '未发现可选端点，请手工填写设备地址和实际 RAW 端口。此结果不表示打印机不存在。'; list.append(note) }
  for (const candidate of result.candidates) {
    const button = document.createElement('button'); button.className = 'candidate'
    button.textContent = `${candidate.host}:${candidate.port} · 仅 TCP 可连接，尚未验证出票 · 选择`
    button.addEventListener('click', () => { input('host').value = candidate.host; input('port').value = String(candidate.port); input('test-ready').checked = false; if (current) render(current) })
    list.append(button)
  }
})
el('test').addEventListener('click', async () => {
  if (!input('test-ready').checked) return
  const mode = document.querySelector<HTMLInputElement>('input[name=mode]:checked')!.value
  const rawPort = input('port').value
  if (!/^[1-9][0-9]{0,4}$/.test(rawPort)) { el('status-message').textContent = '请输入 1–65535 的整数端口。'; return }
  input('paper-confirmed').checked = false; input('same-printer').checked = false
  await act('test', { mode, host: input('host').value, port: Number(rawPort) })
  input('test-ready').checked = false
})
el('confirm').addEventListener('click', () => { if (current?.test) void act('confirmTest', {
  id: current.test.id, paperConfirmed: input('paper-confirmed').checked, sameOriginalPrinter: input('same-printer').checked }) })
void refresh()
setInterval(() => { if (!busy) void refresh() }, 2000)
