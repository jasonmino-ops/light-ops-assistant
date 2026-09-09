type Status = { version: string; server: string; storeCode: string | null; ready: boolean; busy: boolean; code: string;
  mode: string | null; enabled: boolean; endpoint: { host: string; port: number } | null; revision: number;
  restartRequired: boolean; coldEnableCheckRequired: boolean; coldProcess: boolean;
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
  SETUP_OR_PAUSED: '已配置设备可直接启用；首次配置请先确认 TEST 纸票。',
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
  ADDON_MODE_LOCKED: '已配置模式在常规设置中锁定。请使用「变更已配置模式（冷切换）」。',
  ADDON_PROFILE_RESTART_REQUIRED: '已安全停止，本次进程只允许查看状态或安全退出。请退出并重启，保留全部原记录。',
  ADDON_PROFILE_BUSY_OR_FAULTED: '本机配置写入未完成。请保留原记录，安全退出后重启；不要清空重装。',
  ADDON_COLD_PROCESS_RESTART_REQUIRED: '本次进程曾启用打印或修改配置，不能直接切换。请先「暂停并安全退出」，重新打开后保持暂停。',
  ADDON_COLD_CLOSE_CASHIER_REQUIRED: '请先关闭本店所有电脑的 Network 收银标签页并停止新单，再确认。切换后请使用新的收银入口。',
  ADDON_COLD_PAUSE_REQUIRED: '冷切换需要保持暂停。请先暂停并安全退出，然后重新打开。',
  ADDON_COLD_SAME_MODE: '目标与当前模式相同，配置没有变更，也不会出票。',
  ADDON_COLD_SETTLED_TEST_REQUIRED: '需要保留有效的原打印机确认记录。当前不能冷切换，请保留记录并联系支持。',
  ADDON_COLD_LOCAL_WORK_UNSETTLED: '本地存在未完成、未回执或结果不明的打印记录，不能冷切换或首次启用新模式。请核对原订单，不要清空记录或补打。',
  ADDON_COLD_CLOUD_WORK_PENDING: '云端仍有待处理、已领取或执行中的任务。请核对并按原模式处理历史任务，不能清空记录或直接切换。',
  ADDON_COLD_CLOUD_UNKNOWN: '云端存在结果不明的任务，不能继续。请保留记录并由负责人核对原订单和纸票。',
  ADDON_COLD_EXPLICIT_ENABLE_REQUIRED: '新模式已保存并保持暂停。关闭所有旧 Network 收银页、确认单 Agent 后，手动启用并打开新的收银入口。',
  ADDON_COLD_TRANSACTION_BLOCKED: '模式变更或恢复未能完整确认，已安全停止。请保留全部目录和记录，联系支持；不要清空重装。',
  ADDON_COLD_PROVENANCE_INVALID: '模式变更历史校验未通过，已安全停止。请保留全部记录并联系支持。',
  NETWORK_DEVICE_CHANGED: '当前地址的设备与原确认打印机不同，已拒绝操作。请检查原打印机地址，不要重新发送销售补票。',
  NETWORK_DEVICE_IDENTITY_UNAVAILABLE: '无法确认原打印机的硬件地址。请检查本地网络并保持暂停。',
  NETWORK_INVALID_QUEUE_STATE: '无法确认云端队列状态，已拒绝操作。请保留记录，检查网络或联系支持。',
  NETWORK_QUEUED_MODE_MISMATCH: '检测到与当前模式不同的历史任务，已停止领取。请关闭旧收银页并联系负责人处理原任务。',
  NETWORK_QUEUE_STATE_UNAVAILABLE: '云端队列暂时无法核实，已拒绝继续。请保持暂停，检查网络或联系支持。',
}
function message(code: string) { return messages[code] ?? '操作未完成或打印异常。请保留下面的错误代码并核对网络、绑定和原订单；不要重新提交销售补票。' }
async function invoke(action: string, value: unknown = {}) {
  const result = await window.networkAddon.invoke(action, value)
  if (!result.ok) throw new Error(result.code ?? 'ADDON_OPERATION_FAILED')
  return result.value
}
function render(state: Status) {
  const previousMode = current?.mode
  current = state
  const blocked = busy || state.busy || state.restartRequired
  el('store').textContent = state.storeCode ? `绑定门店 · ${state.storeCode}` : '等待 Desktop 门店绑定'
  el('pill').textContent = state.enabled && state.code === 'RUNNING' ? 'NETWORK 已启用' : '设置 / 需要注意'
  el('status-message').textContent = message(state.code)
  el('version').textContent = `v${state.version} · ${state.server}`
  el('diagnostic').textContent = [state.code, state.lastEvent?.jobId, state.lastEvent?.resultCode, state.lastEvent?.effectBoundary].filter(Boolean).join(' · ')
  el('configured-endpoint').textContent = state.endpoint ? `已确认端点：${state.endpoint.host}:${state.endpoint.port} · 配置修订 ${state.revision}` : '尚未确认任何打印设备'
  for (const radio of Array.from(document.querySelectorAll<HTMLInputElement>('input[name=mode]'))) {
    radio.disabled = !!state.mode || blocked
    if (state.mode) radio.checked = radio.value === state.mode
  }
  input('autostart').checked = state.autostart
  const testPending = !!state.test && ['INTENT', 'SUBMITTED', 'UNKNOWN'].includes(state.test.outcome)
  const canConfigure = state.ready && !state.enabled && !blocked && !state.coldEnableCheckRequired
  el<HTMLButtonElement>('discover').disabled = !canConfigure
  el<HTMLButtonElement>('test').disabled = !canConfigure || testPending || !input('test-ready').checked
  el<HTMLButtonElement>('pause').disabled = !state.ready || blocked
  el<HTMLButtonElement>('retry-binding').disabled = state.ready || blocked
  el<HTMLButtonElement>('enable').disabled = !state.ready || state.enabled || !state.revision || blocked || state.test?.outcome !== 'CONFIRMED' || !input('single-agent').checked
    || (state.coldEnableCheckRequired && !input('enable-tabs-closed').checked)
  el<HTMLButtonElement>('cashier').disabled = !state.enabled || blocked || state.code !== 'RUNNING'
  el<HTMLButtonElement>('confirm').disabled = !canConfigure || !input('paper-confirmed').checked || (state.revision > 0 && !input('same-printer').checked)
  input('autostart').disabled = blocked
  el('enable-tabs-row').hidden = !state.coldEnableCheckRequired
  el<HTMLButtonElement>('pause-exit').disabled = !state.ready || blocked
  el<HTMLButtonElement>('safe-exit').disabled = busy || state.busy
  const coldMode = el<HTMLSelectElement>('cold-mode')
  if (previousMode !== state.mode && state.mode) coldMode.value = state.mode === 'FRONT_ONLY' ? 'SHARED_PRINTER' : 'FRONT_ONLY'
  for (const option of Array.from(coldMode.options)) option.disabled = option.value === state.mode
  const canConvert = state.ready && !!state.mode && !state.enabled && !blocked && state.coldProcess && state.test?.outcome === 'CONFIRMED'
  coldMode.disabled = !canConvert
  el<HTMLButtonElement>('convert-mode').disabled = !canConvert || coldMode.value === state.mode || !input('cold-tabs-closed').checked || !input('cold-single-agent').checked
  el('cold-status').textContent = state.restartRequired ? '请安全退出并重新打开，当前不能继续操作。'
    : state.coldEnableCheckRequired ? '已切换；请按「开始营业」的提示手动启用。首次启用会再次检查云端队列。'
      : !state.mode ? '首次配置完成后才可使用冷切换。'
        : !state.coldProcess || state.enabled ? '请先暂停并安全退出，再重新打开。'
          : '当前从暂停状态启动，尚未领取任务。确认后仍需通过本地与云端检查。'
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
for (const id of ['test-ready', 'paper-confirmed', 'single-agent', 'same-printer', 'enable-tabs-closed', 'cold-tabs-closed', 'cold-single-agent']) input(id).addEventListener('change', () => { if (current) render(current) })
el('cold-mode').addEventListener('change', () => { if (current) render(current) })
el('retry-binding').addEventListener('click', () => { void act('retryBinding') })
el('pause').addEventListener('click', () => { void act('pause') })
el('enable').addEventListener('click', () => { void act('enable', { singleAgentConfirmed: input('single-agent').checked, cashierTabsClosed: input('enable-tabs-closed').checked }) })
el('pause-exit').addEventListener('click', () => { void act('pauseAndExit') })
el('safe-exit').addEventListener('click', () => { void act('exit') })
el('convert-mode').addEventListener('click', () => { void act('convertMode', { mode: el<HTMLSelectElement>('cold-mode').value,
  cashierTabsClosed: input('cold-tabs-closed').checked, singleAgentConfirmed: input('cold-single-agent').checked }) })
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
