import { parsePrivateTcpEndpoint } from './printing/localEndpointAuthority'
import type { PrintSettingsRequest } from '../shared/v3PrintSettings'

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function target(value: unknown): Extract<PrintSettingsRequest, { action: 'save' }>['target'] | null {
  const row = object(value)
  if (!row) return null
  const keys = Object.keys(row).sort().join(',')
  if (keys === 'host,kind,port' && row.kind === 'TCP' && typeof row.host === 'string' && row.host === row.host.trim()) {
    const endpoint = parsePrivateTcpEndpoint({ host: row.host, port: row.port })
    return endpoint ? { kind: 'TCP', ...endpoint } : null
  }
  if (keys === 'key,kind,portName,queueName' && row.kind === 'USB' && typeof row.queueName === 'string' && row.queueName === row.queueName.trim() &&
      /^[\p{L}\p{M}\p{N} ._()-]{1,128}$/u.test(row.queueName) && typeof row.portName === 'string' && row.portName === row.portName.trim() &&
      /^USB[0-9]{3,5}$/.test(row.portName) && typeof row.key === 'string' && /^[a-f0-9]{64}$/.test(row.key)) {
    return { kind: 'USB', queueName: row.queueName, portName: row.portName, key: row.key }
  }
  return null
}

export function readPrintSettingsRequest(value: unknown): PrintSettingsRequest | null {
  const row = object(value)
  if (!row || typeof row.storeCode !== 'string' || row.storeCode !== row.storeCode.trim() || !/^[A-Za-z0-9_-]{1,64}$/.test(row.storeCode)) return null
  const keys = Object.keys(row).sort().join(',')
  const { action, storeCode, revision } = row
  if (keys === 'action,storeCode' && (action === 'read' || action === 'queues')) return { action, storeCode }
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) return null
  if (keys === 'action,revision,storeCode' && action === 'test') return { action, storeCode, revision }
  if (keys === 'action,revision,role,storeCode,transport' && action === 'test-role') {
    if (row.role === 'FRONT' && (row.transport === 'USB' || row.transport === 'TCP')) {
      return { action, storeCode, revision, role: row.role, transport: row.transport }
    }
    if (row.role === 'KITCHEN' && row.transport === 'TCP') {
      return { action, storeCode, revision, role: row.role, transport: row.transport }
    }
    return null
  }
  if (keys !== 'action,revision,role,storeCode,target' || action !== 'save' ||
    (row.role !== 'FRONT' && row.role !== 'KITCHEN')) return null
  const endpoint = target(row.target)
  return endpoint && (row.role === 'FRONT' || endpoint.kind === 'TCP')
    ? { action, storeCode, revision, role: row.role, target: endpoint } : null
}

const confirmation = {
  zh: {
    cancel: '取消', confirm: '确认', save: '保存本机打印配置', test: '打印测试票',
    verify: '请核对上方角色和打印机。网络打印请与打印机上显示的 IP 地址及端口核对。',
    pause: '请确认已暂停接单并核对所有待打印任务。',
    noSale: '向上方已保存的打印机发送一张测试票。不会创建销售记录。',
  },
  en: {
    cancel: 'Cancel', confirm: 'Confirm', save: 'Save local print settings', test: 'Print test receipt',
    verify: 'Check the role and printer above. For a network printer, verify its configured IP address and port.',
    pause: 'Confirm that order intake is paused and all pending print jobs have been checked.',
    noSale: 'Send one test receipt to the saved printer above. This creates no sale.',
  },
  km: {
    cancel: 'បោះបង់', confirm: 'បញ្ជាក់', save: 'រក្សាទុកការកំណត់បោះពុម្ព', test: 'បោះពុម្ពបង្កាន់ដៃសាកល្បង',
    verify: 'សូមផ្ទៀងផ្ទាត់តួនាទី និងម៉ាស៊ីនបោះពុម្ពខាងលើ។ សម្រាប់ម៉ាស៊ីនបោះពុម្ពបណ្ដាញ សូមផ្ទៀងផ្ទាត់អាសយដ្ឋាន IP និងច្រក។',
    pause: 'សូមបញ្ជាក់ថាបានផ្អាកការទទួលការបញ្ជាទិញ និងបានពិនិត្យកិច្ចការបោះពុម្ពដែលនៅរង់ចាំ។',
    noSale: 'ផ្ញើបង្កាន់ដៃសាកល្បងមួយទៅម៉ាស៊ីនបោះពុម្ពដែលបានរក្សាទុកខាងលើ។ វាមិនបង្កើតការលក់ទេ។',
  },
} as const

export function printSettingsConfirmation(
  request: Extract<PrintSettingsRequest, { action: 'save' | 'test-role' }>, lang: keyof typeof confirmation, confirmedTarget?: string,
): import('electron').MessageBoxOptions {
  const copy = confirmation[lang]
  const target = request.action === 'save'
    ? request.target.kind === 'USB' ? `${request.target.queueName} (${request.target.portName})` : `${request.target.host}:${request.target.port}`
    : confirmedTarget
  return {
    type: 'question', title: 'E-Shop Desktop', noLink: true, defaultId: 0, cancelId: 0,
    buttons: [copy.cancel, copy.confirm],
    message: request.action === 'save' ? copy.save : copy.test,
    detail: request.action === 'save'
      ? `${request.storeCode} · ${request.role} · ${target}\n${copy.pause}`
      : `${request.storeCode} · ${request.role} · ${request.transport} · ${target}\n${copy.verify}\n${copy.noSale}`,
  }
}
