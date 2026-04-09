/**
 * lib/support-faq.ts
 *
 * 支持助手 v1 — FAQ 卡片、语言检测、消息路由
 *
 * 消息分流规则：
 *   A — 业务口令（新商品/确认等）→ 现有导入流程，不拦截
 *   B — FAQ 关键词命中             → 模板回复
 *   C — 通用问题                   → OWNER 显示功能提示；STAFF 提示联系老板
 *   D — 升级关键词（人工/故障等）  → 发升级回复 + session → awaiting_human
 */

// ─── FAQ 主题 ─────────────────────────────────────────────────────────────────

export type FaqTopic = {
  id: string
  /** 小写关键词；命中任意一个即触发 */
  keywords: string[]
  reply: { zh: string; en: string; km: string }
}

export const FAQ_TOPICS: FaqTopic[] = [
  {
    id: 'install',
    keywords: ['安装', '打不开', '怎么进', '怎么用', '怎么打开', 'install', 'how to open', 'how to use', 'open app'],
    reply: {
      zh: '📱 如何使用店小二\n\n在 Telegram 中点击 Mini App 链接即可打开。\n\n常见问题：\n  · 打不开 → 更新 Telegram 至最新版\n  · 无权限 → 联系老板申请邀请\n  · 网络慢 → 稍后重试\n\n如需更多帮助，回复「人工」联系客服。',
      en: '📱 How to use the app\n\nOpen the Mini App link in Telegram.\n\nCommon issues:\n  · Cannot open → Update Telegram\n  · No access → Ask your manager for an invite\n  · Slow → Retry later\n\nReply "human" for more help.',
      km: '📱 របៀបប្រើ\n\nចុច Mini App link នៅក្នុង Telegram.\n\nបញ្ហាទូទៅ:\n  · បើកមិនបាន → Update Telegram\n  · មិនមាន access → សុំ invite ពី manager\n\nReply "ជំនួយ" ដើម្បីទទួលការជួយ',
    },
  },
  {
    id: 'binding',
    keywords: ['绑定', '怎么绑', '邀请员工', '新员工', '绑账号', 'bind', 'invite staff', 'link account'],
    reply: {
      zh: '🔗 账号绑定 / 邀请员工\n\n老板邀请员工步骤：\n  1. 进入「后台 → 用户管理」\n  2. 点击「生成邀请链接」\n  3. 将链接发给员工，员工点击即自动绑定\n\n绑定后员工在 Telegram 打开 Mini App 即可使用。\n\n如需帮助，回复「人工」联系客服。',
      en: '🔗 Binding / Invite Staff\n\nTo invite staff:\n  1. Go to Admin → User Management\n  2. Click "Generate Invite Link"\n  3. Send the link to staff — they tap it to bind\n\nReply "human" for support.',
      km: '🔗 ការភ្ជាប់ / ការអញ្ជើញ Staff\n\nដើម្បី invite staff:\n  1. ចូល Admin → User Management\n  2. ចុច "Generate Invite Link"\n  3. ផ្ញើ link → staff ចុច ដើម្បីភ្ជាប់\n\nReply "ជំនួយ" ដើម្បីទទួលការជួយ',
    },
  },
  {
    id: 'product_entry',
    keywords: ['录商品', '添加商品', '怎么加商品', '商品录入', 'add product', 'new product', 'product entry'],
    reply: {
      zh: '📦 录入商品\n\n发口令「新商品」进入导入模式，每行一个：\n\n  苹果 | 1234567890 | 3.5\n\n识别规则：\n  · 5 位以上纯数字 → 条码\n  · 含小数点或短整数 → 售价\n  · 其余文字 → 商品名称（支持中/英/柬语）\n\n也可直接发 .xlsx/.csv 文件批量导入。',
      en: '📦 Adding Products\n\nSend "new goods" to enter import mode, one per line:\n\n  Apple | 1234567890 | 3.5\n\nRules:\n  · 5+ digit number → barcode\n  · decimal/short int → price\n  · remaining text → name\n\nOr send a .xlsx/.csv file for bulk import.',
      km: '📦 ការបញ្ចូលទំនិញ\n\nផ្ញើ "new goods" ដើម្បីចាប់ផ្តើម ១ ជួរ = ១ ផលិតផល:\n\n  Apple | 1234567890 | 3.5\n\nOr send .xlsx/.csv file.',
    },
  },
  {
    id: 'excel_import',
    keywords: ['excel', 'xlsx', 'csv', '表格', '文件导入', '导入文件', 'import file', 'upload file', 'spreadsheet'],
    reply: {
      zh: '📊 Excel/CSV 批量导入\n\n直接将 .xlsx 或 .csv 文件发到对话框，无需口令。\n\n表头要求（中英文均支持）：\n  · 商品名称 / name / product\n  · 条码 / barcode / sku\n  · 售价 / price / unit price\n\n列顺序不限，说明行会自动跳过。\n预览后回复「确认」完成导入。',
      en: '📊 Excel/CSV Bulk Import\n\nSend a .xlsx or .csv file directly — no command needed.\n\nRequired columns:\n  · name / product name\n  · barcode / sku\n  · price / unit price\n\nColumn order is flexible. Reply "confirm" after preview.',
      km: '📊 Excel/CSV Import\n\nផ្ញើ .xlsx ឬ .csv file ដោយផ្ទាល់.\n\nColumn ដែលត្រូវការ:\n  · name / barcode / price\n\nReply "confirm" ដើម្បីបញ្ចូល.',
    },
  },
  {
    id: 'scan',
    keywords: ['扫码', '扫不出', '扫描问题', '扫不到', 'scan', 'barcode scan', 'camera', 'qr code'],
    reply: {
      zh: '📷 扫码问题\n\n常见原因：\n  · 光线不足 → 确保环境光线充足\n  · 条码污损/模糊 → 尝试手动输入条码\n  · 商品未录入 → 先在商品管理中添加\n  · 摄像头权限 → 检查浏览器是否授权\n  · 设备兼容 → 尝试换一部手机\n\n仍有问题请回复「人工」联系客服。',
      en: '📷 Scan Issues\n\nCommon causes:\n  · Low light → improve lighting\n  · Damaged barcode → try manual entry\n  · Product not added → add it first\n  · Camera permission → grant browser access\n\nReply "human" for further support.',
      km: '📷 បញ្ហា Scan\n\nមូលហេតុទូទៅ:\n  · ពន្លឺខ្សោយ → ធ្វើឱ្យពន្លឺ\n  · barcode ខូច → វាយដោយដៃ\n  · product មិនទាន់បញ្ចូល → បញ្ចូលជាមុន\n\nReply "ជំនួយ"',
    },
  },
]

// ─── 固定回复文案 ─────────────────────────────────────────────────────────────

/** D 类：升级到人工客服 */
export const ESCALATION_REPLY: Record<string, string> = {
  zh: '🙋 已通知人工客服，稍后会回复您。\n\n等待期间可继续描述问题，或发截图，方便客服更快处理。\n感谢您的耐心等待。',
  en: '🙋 Human support has been notified. We will reply shortly.\n\nFeel free to describe your issue or send a screenshot while waiting.\nThank you for your patience.',
  km: '🙋 ការគាំទ្រពីមនុស្សត្រូវបានជូនដំណឹង។ យើងនឹងឆ្លើយ​ឆាប់ៗ.\n\nអ្នកអាចពិពណ៌នាបញ្ហា ឬផ្ញើ screenshot ពេលរង់ចាំ.\nអរគុណ',
}

/** C 类：OWNER 通用问题 */
export const GENERAL_HELP_OWNER: Record<string, string> = {
  zh: '👋 您好！我是店小二助手。\n\n常用功能：\n  · 发「新商品」→ 文字批量录入\n  · 发 Excel/CSV 文件 → 批量导入\n  · App 销售页面 → 扫码开单\n  · App 记录页面 → 历史订单\n\n有产品问题可以直接问我，或回复「人工」联系客服。',
  en: '👋 Hi! I\'m your shop assistant.\n\nCommon features:\n  · Send "new goods" → bulk add products\n  · Send Excel/CSV → bulk import\n  · Sales page in App → scan & checkout\n  · Records page → order history\n\nAsk me product questions, or reply "human" for support.',
  km: '👋 សួស្ដី! ខ្ញុំជា shop assistant.\n\nមុខងារ:\n  · ផ្ញើ "new goods" → បញ្ចូលទំនិញ\n  · ផ្ញើ Excel/CSV → import\n  · Sales page → scan\n\nReply "ជំនួយ" ដើម្បីទទួលការជួយ',
}

/** C 类：STAFF 无权限 AI */
export const GENERAL_HELP_STAFF: Record<string, string> = {
  zh: '👋 您好！如有操作问题，可向您的老板咨询，或回复「人工」寻求客服支持。',
  en: '👋 Hi! For operational questions, please check with your manager, or reply "human" for customer support.',
  km: '👋 សួស្ដី! ប្រសិនបើមានបញ្ហា សូមសួរ manager ឬ reply "ជំនួយ".',
}

// ─── 语言检测 ─────────────────────────────────────────────────────────────────

export function detectLanguage(text: string): 'zh' | 'en' | 'km' {
  if (/[\u1780-\u17FF]/.test(text)) return 'km'
  if (/[\u4e00-\u9FFF\u3400-\u4DBF]/.test(text)) return 'zh'
  return 'en'
}

// ─── FAQ 匹配 ─────────────────────────────────────────────────────────────────

export function matchFaq(text: string): FaqTopic | null {
  const lower = text.toLowerCase()
  for (const topic of FAQ_TOPICS) {
    if (topic.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return topic
    }
  }
  return null
}

// ─── 消息路由 ─────────────────────────────────────────────────────────────────

/** 不拦截，交给现有导入流程处理的业务口令 */
const BUSINESS_PASS_THROUGH = new Set([
  '新商品', 'new good', 'new goods',
  '确认', 'confirm', 'yes', 'ok',
])

/** 升级关键词 → D 类 */
const ESCALATE_KW = [
  '人工', '转人工', '联系客服', '故障', '出错',
  'human', 'agent', 'ជំនួយ',
]

export type RouteCategory = 'A' | 'B' | 'C' | 'D'

/**
 * 将一条非空文字消息路由到四个分类之一。
 *   A — 导入/确认口令          → 现有流程，不拦截
 *   B — FAQ 关键词              → 模板回复
 *   C — 通用问题                → 角色差异回复
 *   D — 升级关键词              → 人工通知 + session awaiting_human
 */
export function routeMessage(text: string): RouteCategory {
  const norm = text.trim().toLowerCase().replace(/\s+/g, ' ')
  if (BUSINESS_PASS_THROUGH.has(norm)) return 'A'
  if (ESCALATE_KW.some((kw) => norm.includes(kw))) return 'D'
  if (matchFaq(text)) return 'B'
  return 'C'
}
