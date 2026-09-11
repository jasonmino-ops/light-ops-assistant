type Status = { version: string; server: string; storeCode: string | null; ready: boolean; busy: boolean; code: string;
  cashierAvailable: boolean; entryCode: string; entryPending: boolean;
  shortcutCode: string;
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
// 用户主动点了「打印设置」。设置完成后回到日常屏。
let showSettings = false
const messages: Record<string, string> = {
  ENTRY_IDLE: '日常点桌面上的「店小二收银」就可以。第一次使用请先完成门店绑定和打印机设置。',
  ENTRY_OPENING: '正在打开收银台，请不要重复点击。',
  ENTRY_OPENED: '收银台已经在 Chrome 里打开了。请核对一下浏览器里显示的门店是否正确。',
  ENTRY_CANCELLED: '已取消打开收银台。设置没有任何改动。',
  ENTRY_PRINT_WARNING: '打印当前是暂停或异常状态。继续开单可以，但票不会自动出，也不会转到原来的打印方式。',
  ADDON_CASHIER_SETUP_REQUIRED: '请先把打印方式和打印机设置好，再进入收银台。',
  ADDON_ENTRY_CONFIGURATION_CHANGED: '刚才设置有改动，已经取消打开收银台。请退出程序后重新打开。',
  ADDON_EXIT_IN_PROGRESS: '正在安全退出，请等它结束后再点桌面上的收银图标。',
  SHORTCUT_NEEDS_ATTENTION: '有几个桌面图标无法确认来源，已经原样保留。请到「整理桌面图标」里看一下。',
  SHORTCUT_HISTORY_INVALID: '桌面图标的记录无法核对，原文件已经保留。请联系技术支持，不要自己清空目录重试。',
  RUNNING: '打印已开启。收银台开的每一单都会自动出票。',
  PAUSED: '已暂停。设置和记录都还在，随时可以重新开始。',
  SETUP_OR_PAUSED: '打印机已经设置好，可以直接开始。第一次设置请先打一张测试票并确认。',
  CONFIGURED_PAUSED: '设置已保存。确认本店只有这一台电脑负责打印，就可以开始了。',
  TEST_AWAITING_PHYSICAL_CONFIRMATION: '测试票已经送出去了。请去打印机那里拿一下纸，确认之后再继续。不会自动重发。',
  DESKTOP_BINDING_IDENTITY_UNAVAILABLE: '还没连上门店。请先打开「店小二」完成门店绑定，再回到这里点「重新读取门店」。',
  DESKTOP_BINDING_NOT_ACTIVE: '门店绑定还没有生效。请在「店小二」里完成绑定；本程序不会改动原来的身份信息。',
  ADDON_CHROME_REQUIRED: '需要 Google Chrome 才能打开收银台。请先装好 Chrome 再试。',
  ADDON_TEST_REVIEW_REQUIRED: '上一张测试票还没确认，或者不确定有没有打出来。请先去打印机那里看一眼，不要反复发送。',
  NETWORK_UNCERTAIN_EFFECT_REQUIRES_REVIEW: '有单不确定有没有出纸，已经停止自动打印。请把下面这一行记录交给负责人核对；程序不会自己补打。',
  ADDON_INITIALIZATION_INCOMPLETE_OR_PROFILE_LOST: '这台电脑上的设置记录缺失或没写完，已经安全停下。请保留原来的文件夹并联系技术支持，不要清空重装。',
  ADDON_SINGLE_AGENT_CONFIRMATION_REQUIRED: '请先确认本店没有别的电脑也在跑打印。',
  NETWORK_CHANGED: '网络变了。请保持暂停，重新搜索打印机，并确认还是原来那一台。',
  ADDON_PAUSE_REQUIRED: '请先暂停打印，等当前这一单安全结束。',
  ADDON_MODE_LOCKED: '打印方式设置好之后就锁住了。要改请用下面的「更换打印方式」。',
  ADDON_PROFILE_RESTART_REQUIRED: '程序已经安全停下。这一次只能查看状态或退出。请退出后重新打开，所有记录都会保留。',
  ADDON_PROFILE_BUSY_OR_FAULTED: '设置还没写完。请保留原记录，退出后重新打开，不要清空重装。',
  ADDON_COLD_PROCESS_RESTART_REQUIRED: '这次打开之后已经启用过打印或改过设置，不能直接换打印方式。请先「暂停并退出」，重新打开后保持暂停再来换。',
  ADDON_COLD_CLOSE_CASHIER_REQUIRED: '请先关掉本店所有电脑上的收银页面，并停止开新单，再确认。换完之后要用新的收银入口。',
  ADDON_COLD_PAUSE_REQUIRED: '换打印方式需要先暂停。请「暂停并退出」，然后重新打开本程序。',
  ADDON_COLD_SAME_MODE: '和现在用的是同一种打印方式，没有变化，也不会出纸。',
  ADDON_COLD_SETTLED_TEST_REQUIRED: '需要保留原打印机的确认记录才能更换。现在不能换，请保留记录并联系技术支持。',
  ADDON_COLD_LOCAL_WORK_UNSETTLED: '这台电脑上还有没打完、或者结果不确定的票，不能更换打印方式。请先核对那几单，不要清记录，也不要补打。',
  ADDON_COLD_CLOUD_WORK_PENDING: '还有单在排队或正在处理。请按原来的打印方式把它们处理完，不能直接换，也不能清空记录。',
  ADDON_COLD_CLOUD_UNKNOWN: '有单结果不确定，不能继续。请保留记录，由负责人核对原订单和实际纸票。',
  ADDON_COLD_EXPLICIT_ENABLE_REQUIRED: '新的打印方式已保存，当前保持暂停。请关掉所有旧的收银页面、确认只有这一台电脑打印，然后手动开始，并用新的收银入口。',
  ADDON_COLD_TRANSACTION_BLOCKED: '更换打印方式没有完整完成，已经安全停下。请保留全部记录并联系技术支持，不要清空重装。',
  ADDON_COLD_PROVENANCE_INVALID: '更换记录核对没通过，已经安全停下。请保留全部记录并联系技术支持。',
  NETWORK_DEVICE_CHANGED: '这个地址上的设备和原来确认过的打印机不是同一台，已经拒绝操作。请核对打印机地址，不要重新开单补票。',
  NETWORK_DEVICE_IDENTITY_UNAVAILABLE: '没法确认这是不是原来那台打印机。请检查本店网络，并保持暂停。',
  NETWORK_INVALID_QUEUE_STATE: '没法确认排队情况，已经拒绝操作。请保留记录，检查网络或联系技术支持。',
  NETWORK_QUEUED_MODE_MISMATCH: '发现了用另一种打印方式产生的历史任务，已经停止领取。请关掉旧的收银页面并联系负责人处理。',
  NETWORK_QUEUE_STATE_UNAVAILABLE: '暂时连不上服务器核对排队情况，已经停下。请保持暂停，检查网络或联系技术支持。',
  // 以下是「本机读取自己的网络信息」失败。此时没有向打印机发送任何东西，
  // 没有任何订单受影响，所以不提打印机电源/网线/路由器，也不提补票。
  NETWORK_METADATA_TIMEOUT: '这台电脑读自己的网络信息用的时间比平时长，已经自动重试了一次。没有任何单受影响。如果这一行一直不消失，请把这台电脑重启一次。',
  NETWORK_METADATA_COMMAND_FAILED: '这台电脑的系统网络信息暂时读不出来，已经自动重试了一次。没有任何单受影响。如果一直这样，请重启这台电脑，或联系技术支持。',
  NETWORK_METADATA_TOOL_MISSING: '这台电脑缺少读取网络信息所需的系统组件，程序没法自己解决。没有任何单受影响。请联系技术支持，不用重装本程序。',
  NETWORK_METADATA_CANCELLED: '刚才读取网络信息的操作被中断了，通常是因为退出程序或中途切换了操作。没有任何单受影响，重新操作一次就好。',
  NETWORK_METADATA_UNAVAILABLE: '这台电脑暂时读不到自己的网络信息，已经自动重试了一次。没有任何单受影响。如果一直这样，请重启这台电脑，或联系技术支持。',
}
function message(code: string) { return messages[code] ?? '操作没有完成，或者打印出了问题。请保留下面的错误代码，核对网络、门店绑定和原订单；不要重新开单补票。' }
async function invoke(action: string, value: unknown = {}) {
  const result = await window.networkAddon.invoke(action, value)
  if (!result.ok) throw new Error(result.code ?? 'ADDON_OPERATION_FAILED')
  return result.value
}
// 决定显示哪一屏。只使用 status() 已有的字段，不引入任何新的探测或计数。
function decideView(state: Status): { view: 'calm' | 'alarm' | 'setup'; severity: 'down' | 'unsure' } {
  const settled = state.ready && !!state.mode && state.revision > 0 && state.test?.outcome === 'CONFIRMED'
  if (showSettings || !settled || state.restartRequired || state.coldEnableCheckRequired) return { view: 'setup', severity: 'down' }
  const uncertain = state.lastEvent?.effectBoundary === 'CROSSING_UNKNOWN' || state.code === 'NETWORK_UNCERTAIN_EFFECT_REQUIRES_REVIEW'
  if (uncertain) return { view: 'alarm', severity: 'unsure' }
  if (state.enabled && state.code !== 'RUNNING') return { view: 'alarm', severity: 'down' }
  return { view: 'calm', severity: 'down' }
}
function pillText(state: Status, view: string, severity: string) {
  if (view === 'alarm') return severity === 'unsure' ? '有单要核对' : '打印有问题'
  if (view === 'calm') return state.enabled ? '打印正常' : '已暂停'
  if (!state.ready) return '正在启动'
  return state.mode ? '需要处理' : '准备设置'
}
function render(state: Status) {
  const previousMode = current?.mode
  current = state
  const blocked = busy || state.busy || state.restartRequired
  const { view, severity } = decideView(state)
  const root = document.querySelector('main') as HTMLElement
  root.dataset.view = view
  root.dataset.severity = severity
  el('store').textContent = state.storeCode ? state.storeCode : '还没连上门店'
  el('pill').textContent = pillText(state, view, severity)
  el('status-message').textContent = view === 'calm' && state.enabled && state.code === 'RUNNING' && state.endpoint
    ? `${state.mode === 'SHARED_PRINTER' ? '小票 ＋ 厨房单' : '只打小票'} · 打印机 ${state.endpoint.host}`
    : message(state.code)
  el('version').textContent = `店小二打印 ${state.version}`
  el('diagnostic').textContent = [state.lastEvent?.jobId ? `任务 ${state.lastEvent.jobId}` : null,
    state.code, state.lastEvent?.resultCode, state.lastEvent?.effectBoundary].filter(Boolean).join(' · ')
  el('configured-endpoint').textContent = state.endpoint ? `当前打印机：${state.endpoint.host}，端口 ${state.endpoint.port}` : '还没有确认过打印机'
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
  el<HTMLButtonElement>('cashier').disabled = !state.cashierAvailable || blocked || state.entryPending
  el('cashier').textContent = view === 'alarm' ? '仍然开始营业' : state.enabled ? '开始营业' : '打开收银台'
  el('entry-message').textContent = state.entryCode && state.entryCode !== 'READY'
    ? (messages[state.entryCode] ?? '请按提示完成设置，或先看一下打印状态。打开收银台不会解除暂停，也不会转到原来的打印方式。')
    : view === 'calm' && state.enabled ? '也可以直接点桌面上的「店小二收银」。'
      : view === 'alarm' ? '现在开单可以，但票不会自动出来。'
        : state.enabled ? '也可以直接点桌面上的「店小二收银」。'
          : '打印当前是暂停的。仍然可以开单，票会先排队等恢复，不会转到原来的打印方式。'
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
  el('cold-status').textContent = state.restartRequired ? '请先退出程序再重新打开，现在不能继续操作。'
    : state.coldEnableCheckRequired ? '已经换好了。请按第 3 步「开始营业」手动开启，开启时会再检查一次排队情况。'
      : !state.mode ? '第一次设置完成之后，才能在这里更换打印方式。'
        : !state.coldProcess || state.enabled ? '请先「暂停并退出」，然后重新打开本程序。'
          : '当前是从暂停状态打开的，还没有领取任务。确认之后仍然要通过本机和服务器的检查。'
  input('host').disabled = !canConfigure || testPending
  input('port').disabled = !canConfigure || testPending
  el('confirmation').hidden = state.test?.outcome !== 'SUBMITTED'
  el('same-printer-row').hidden = state.revision === 0
  if (state.test) el('test-summary').textContent = `已向 ${state.test.endpoint.host} 送出一张测试票。送出去了不代表纸一定打出来，请去打印机那里看一眼。`
}
async function refresh() {
  try { render(await invoke('status') as Status) } catch { el('status-message').textContent = '读不到状态。请退出程序后重新打开；不会自动补打任何票。' }
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
el('goto-setup').addEventListener('click', () => { showSettings = true; if (current) render(current) })
el('retry-binding').addEventListener('click', () => { void act('retryBinding') })
el('pause').addEventListener('click', () => { void act('pause') })
el('enable').addEventListener('click', () => { showSettings = false; void act('enable', { singleAgentConfirmed: input('single-agent').checked, cashierTabsClosed: input('enable-tabs-closed').checked }) })
el('pause-exit').addEventListener('click', () => { void act('pauseAndExit') })
el('safe-exit').addEventListener('click', () => { void act('exit') })
el('convert-mode').addEventListener('click', () => { void act('convertMode', { mode: el<HTMLSelectElement>('cold-mode').value,
  cashierTabsClosed: input('cold-tabs-closed').checked, singleAgentConfirmed: input('cold-single-agent').checked }) })
el('cashier').addEventListener('click', () => { void act('cashier') })
type ShortcutResult = { subject: string; status: string; reason?: string; sha256?: string }
const shortcutNames: Record<string, string> = { cashier: '店小二收银', manage: '店小二打印设置',
  'desktop-binding': '门店绑定', uninstall: '卸载店小二打印', desktop: 'E-Shop.lnk',
  'network-formal': 'E-Shop Network Print Add-on.lnk', 'network-test': 'E-Shop Network Print Add-on (TEST ONLY).lnk' }
const shortcutStates: Record<string, string> = { CREATED: '已创建', UNCHANGED: '已检查，保持原样',
  MIGRATED: '已备份并收起', REMOVED: '已收起', RESTORED: '已恢复', ABSENT: '不存在，不用处理',
  PRESERVED: '来源或内容对不上，保持原样', UNAVAILABLE: '无法确认，保持原样', NEEDS_CONFIRMATION: '看起来是安装时创建的，需要你确认一下' }
async function refreshShortcuts() {
  const list = el('shortcut-results'); list.replaceChildren()
  const result = await act('shortcuts') as { created: ShortcutResult[]; legacy: ShortcutResult[] } | undefined
  if (!result) return
  for (const item of [...result.created, ...result.legacy]) {
    const row = document.createElement('div')
    const note = document.createElement('p')
    note.textContent = `${shortcutNames[item.subject] ?? item.subject}：${shortcutStates[item.status] ?? item.status}${item.reason ? `（${item.reason}）` : ''}`
    row.append(note)
    if (item.status === 'NEEDS_CONFIRMATION' && item.sha256) {
      const label = document.createElement('label'); label.className = 'check'
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'
      label.append(checkbox, document.createTextNode(`我确认「${shortcutNames[item.subject]}」是装程序时自动创建的旧图标，不是我自己建的或改过的；同意备份后收起来。`))
      const button = document.createElement('button'); button.className = 'secondary'; button.disabled = true
      button.textContent = '备份并收起这个旧图标'
      checkbox.addEventListener('change', () => { button.disabled = !checkbox.checked })
      button.addEventListener('click', async () => {
        if (!checkbox.checked || busy) return
        button.disabled = true
        await act('migrateShortcut', { id: item.subject, sha256: item.sha256, ownershipConfirmed: true })
        await refreshShortcuts()
      })
      row.append(label, button)
    }
    list.append(row)
  }
}
el('shortcuts').addEventListener('click', () => { if (!busy) void refreshShortcuts() })
input('autostart').addEventListener('change', () => { void act('autostart', { enabled: input('autostart').checked }) })
el('cancel').addEventListener('click', () => { void invoke('cancelDiscovery') })
el('discover').addEventListener('click', async () => {
  el('cancel').hidden = false
  const list = el('candidates'); list.replaceChildren()
  const result = await act('discover') as { candidates: { host: string; port: number }[]; status: string; reason?: string } | undefined
  el('cancel').hidden = true
  if (!result) return
  if (!result.candidates.length) { const note = document.createElement('p'); note.className = 'note'; note.textContent = '这一遍没找到打印机。可以展开下面的「手动填打印机地址」自己填。没找到不代表打印机坏了。'; list.append(note) }
  for (const candidate of result.candidates) {
    const button = document.createElement('button'); button.className = 'candidate'
    button.textContent = `${candidate.host}　端口 ${candidate.port} · 点这里选它`
    button.addEventListener('click', () => { input('host').value = candidate.host; input('port').value = String(candidate.port); input('test-ready').checked = false; if (current) render(current) })
    list.append(button)
  }
})
el('test').addEventListener('click', async () => {
  if (!input('test-ready').checked) return
  const mode = document.querySelector<HTMLInputElement>('input[name=mode]:checked')!.value
  const rawPort = input('port').value
  if (!/^[1-9][0-9]{0,4}$/.test(rawPort)) { el('status-message').textContent = '端口请填 1 到 65535 之间的数字。'; return }
  input('paper-confirmed').checked = false; input('same-printer').checked = false
  await act('test', { mode, host: input('host').value, port: Number(rawPort) })
  input('test-ready').checked = false
})
el('confirm').addEventListener('click', () => { if (current?.test) void act('confirmTest', {
  id: current.test.id, paperConfirmed: input('paper-confirmed').checked, sameOriginalPrinter: input('same-printer').checked }) })
void refresh()
setInterval(() => { if (!busy) void refresh() }, 2000)
