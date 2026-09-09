export const COPY = {
  zh: {
    interval: '统计时段', endExclusive: '截止时刻不含', provisional: '实时结果（未结日），截至', completePeriod: '完整历史时段', legacyPeriod: '此历史日报保留原 06:00 起算口径，未改写为自然日。',
    printTarget: '按当前登录门店的现有配置发送小票；允许提交不代表打印机在线。配置未启用时使用现有浏览器打印。', printSent: '报表已发送，请在打印机确认出纸。', printTooLarge: '报表超出现有小票打印大小限制，请缩小查询范围后再试。',
    printPrepareTimeout: '生成打印内容超时，本次尚未发送。请重试；仍失败时请记录此提示。', printPrepareFailed: '生成打印内容失败，本次尚未发送。请重试。',
    printSendTimeout: '小票发送响应超时，结果未确认。请先检查打印机，再重试；重试会复用同一任务。',
    printBrowserFailed: '浏览器打印未能打开或准备完成，请检查浏览器的打印与弹窗支持后重试。', printBrowserPending: '上次浏览器打印仍在等待清理。请完成或关闭打印窗口后重试；未收到关闭通知时，最多等待 90 秒。',
    retry: '重新加载商品', unavailableStore: '原门店已不可访问',
    title: '商品销售查询', back: '经营查询', intro: '选择重点商品，保存固定组，查看销售和历史日报。',
    rule: '柬埔寨专项口径 · Asia/Phnom_Penh。当地自然日 00:00～24:00；今日、本周、本月从当天、周一或月初 00:00 统计至本次查询时刻。',
    moneyNote: '商品销售额按已记录商品行金额汇总，未分摊整单优惠，不代表订单实收。退款列仅包含可可靠归属商品的已记录退款，不计算商品净营业额。',
    TODAY: '今日', YESTERDAY: '昨日', WEEK: '本周', MONTH: '本月', CUSTOM: '自定义', from: '开始日期', to: '结束日期',
    stores: '门店范围', allStores: '全部有权门店', products: '选择商品', search: '搜索名称、条码或 SKU', selected: '已选商品', more: '加载更多', query: '查询', working: '处理中…',
    groups: '固定商品组', name: '商品组名称', newGroup: '新建商品组', save: '保存新组', update: '更新商品组', enabled: '启用每日自动报表', disabled: '已停用', disable: '停用', history: '历史日报',
    emptyGroups: '暂无固定商品组。选择商品后即可保存。', emptyHistory: '暂无可查看日报。新组从创建当天营业结束后开始生成。', historyNote: '仅显示当前仍有全部门店访问权限的日报。日报保留生成时结果，晚到的销售记录可能使实时重查结果不同。',
    product: '商品', store: '门店', quantity: '销售数量', amount: '商品销售额', refund: '已记录商品退款额', totals: '按币种合计', generated: '生成时间', print: '打印', printFailed: '打印未能确认发送，请检查现有打印服务后重试。',
    failed: '操作失败，请重试。', unauthorized: '仅有有效门店权限的 OWNER 可访问。', incomplete: '部分历史商品行无法识别，未计入汇总；该结果并非完整销售统计。', refundIncomplete: '存在无法归属商品的退款，退款列不是全部退款金额。', emptyProducts: '没有找到商品。', remove: '移除', saved: '商品组已保存。', noSelection: '请选择 1～100 个商品。', noResult: '查询后在此查看和打印结果。', conflict: '商品组已被其他请求修改，请刷新后重试。', invalid: '输入或历史数据无法满足本次查询，请检查日期和商品选择。',
  },
  en: {
    interval: 'Reporting interval', endExclusive: 'end exclusive', provisional: 'Live result (day not closed), as of', completePeriod: 'Complete historical interval', legacyPeriod: 'This saved report retains its original 06:00 start; it has not been rewritten as a calendar day.',
    printTarget: 'Use the signed-in store’s existing receipt configuration. Submission eligibility does not mean a printer is online. Disabled configuration uses existing browser printing.', printSent: 'Report sent. Confirm paper output at the printer.', printTooLarge: 'Report exceeds the existing receipt size limit. Query a smaller range and try again.',
    printPrepareTimeout: 'Preparing print content timed out. Nothing was sent by this attempt. Retry; if it persists, record this message.', printPrepareFailed: 'Could not prepare print content. Nothing was sent by this attempt. Please retry.',
    printSendTimeout: 'Receipt submission timed out; the result is unconfirmed. Check the printer before retrying. A retry reuses the same job.',
    printBrowserFailed: 'Browser printing could not open or finish preparation. Check browser printing and popup support, then retry.', printBrowserPending: 'The previous browser print is awaiting cleanup. Finish or close its window before retrying. Without a close notification, cleanup may take up to 90 seconds.',
    retry: 'Reload products', unavailableStore: 'Original store is unavailable',
    title: 'Product sales', back: 'Business overview', intro: 'Save frequently checked products and view sales and daily reports.',
    rule: 'Cambodia reporting · Asia/Phnom_Penh. Local calendar days: 00:00–24:00. Today/week/month run from midnight today/Monday/day 1 up to this query time.',
    moneyNote: 'Product sales sum recorded item amounts before order coupon allocation; they are not order receipts. Refunds include only recorded refunds reliably linked to products. No product net revenue is calculated.',
    TODAY: 'Today', YESTERDAY: 'Yesterday', WEEK: 'This week', MONTH: 'This month', CUSTOM: 'Custom', from: 'From date', to: 'To date',
    stores: 'Stores', allStores: 'All authorized stores', products: 'Choose products', search: 'Search name, barcode or SKU', selected: 'Selected products', more: 'Load more', query: 'Query', working: 'Working…',
    groups: 'Saved product groups', name: 'Group name', newGroup: 'New group', save: 'Save new group', update: 'Update group', enabled: 'Enable automatic daily reports', disabled: 'Disabled', disable: 'Disable', history: 'Daily report history',
    emptyGroups: 'No groups yet. Choose products to save a group.', emptyHistory: 'No accessible reports yet. A new group starts reporting after its creation day closes.', historyNote: 'Reports require current access to all included stores. Saved reports retain their generation-time results; late sales can change live queries.',
    product: 'Product', store: 'Store', quantity: 'Quantity sold', amount: 'Product sales', refund: 'Recorded product refunds', totals: 'Totals by currency', generated: 'Generated', print: 'Print', printFailed: 'Print submission could not be confirmed. Check the existing printing service and retry.',
    failed: 'Operation failed. Please retry.', unauthorized: 'An OWNER with active store access is required.', incomplete: 'Some historical product lines could not be identified and were excluded. Sales coverage is incomplete.', refundIncomplete: 'Some refunds could not be linked to products. The refund column does not include all refunds.', emptyProducts: 'No products found.', remove: 'Remove', saved: 'Group saved.', noSelection: 'Select 1–100 products.', noResult: 'Run a query to view and print results.', conflict: 'Another request changed this group. Refresh and retry.', invalid: 'The input or historical data cannot support this query. Check dates and product selection.',
  },
  km: {
    interval: 'រយៈពេលរបាយការណ៍', endExclusive: 'មិនរាប់ពេលបញ្ចប់', provisional: 'លទ្ធផលបណ្ដោះអាសន្ន គិតត្រឹម', completePeriod: 'រយៈពេលប្រវត្តិពេញលេញ', legacyPeriod: 'របាយការណ៍នេះរក្សាពេលចាប់ផ្ដើម06:00 ដើម មិនបានប្ដូរជាថ្ងៃប្រតិទិនទេ។',
    printTarget: 'ប្រើការកំណត់បង្កាន់ដៃរបស់ហាងដែលកំពុងចូល។ សិទ្ធិផ្ញើមិនមានន័យថាម៉ាស៊ីនកំពុងភ្ជាប់ទេ។ បើមិនបានបើក ប្រើការបោះពុម្ពតាមកម្មវិធីរុករកដែលមានស្រាប់។', printSent: 'បានផ្ញើរបាយការណ៍។ សូមបញ្ជាក់ក្រដាសចេញពីម៉ាស៊ីន។', printTooLarge: 'របាយការណ៍លើសទំហំបង្កាន់ដៃ។ សូមបន្ថយរយៈពេលស្វែងរក ហើយព្យាយាមម្ដងទៀត។',
    printPrepareTimeout: 'ការរៀបចំមាតិកាបោះពុម្ពហួសពេលកំណត់។ ការព្យាយាមនេះមិនទាន់បានផ្ញើទេ។ សូមព្យាយាមម្ដងទៀត និងកត់ត្រាសារនេះបើនៅតែបរាជ័យ។', printPrepareFailed: 'មិនអាចរៀបចំមាតិកាបោះពុម្ពបាន។ ការព្យាយាមនេះមិនទាន់បានផ្ញើទេ។ សូមព្យាយាមម្ដងទៀត។',
    printSendTimeout: 'ការផ្ញើបង្កាន់ដៃហួសពេលកំណត់ លទ្ធផលមិនទាន់បញ្ជាក់។ សូមពិនិត្យម៉ាស៊ីនមុនព្យាយាមម្ដងទៀត ដែលនឹងប្រើការងារដដែល។',
    printBrowserFailed: 'មិនអាចបើក ឬរៀបចំការបោះពុម្ពតាមកម្មវិធីរុករកបាន។ សូមពិនិត្យការគាំទ្របោះពុម្ព និងផ្ទាំងលោត រួចព្យាយាមម្ដងទៀត។', printBrowserPending: 'ការបោះពុម្ពមុនកំពុងរង់ចាំសម្អាត។ សូមបញ្ចប់ ឬបិទផ្ទាំងបោះពុម្ពមុនព្យាយាមម្ដងទៀត។ បើគ្មានដំណឹងបិទ អាចរង់ចាំរហូតដល់៩០វិនាទី។',
    retry: 'ផ្ទុកទំនិញឡើងវិញ', unavailableStore: 'ហាងដើមមិនអាចចូលបាន',
    title: 'ការលក់តាមទំនិញ', back: 'ទិដ្ឋភាពអាជីវកម្ម', intro: 'រក្សាទុកក្រុមទំនិញ ហើយមើលការលក់ និងរបាយការណ៍ប្រចាំថ្ងៃ។',
    rule: 'សម្រាប់កម្ពុជា · Asia/Phnom_Penh។ ថ្ងៃប្រតិទិន៖ 00:00–24:00។ ថ្ងៃនេះ/សប្ដាហ៍/ខែ៖ ចាប់ពីម៉ោង00:00 នៃថ្ងៃនេះ/ថ្ងៃចន្ទ/ថ្ងៃទី១ ដល់ពេលស្វែងរកនេះ។',
    moneyNote: 'ប្រាក់លក់ទំនិញគឺផលបូកតម្លៃដែលបានកត់ត្រាតាមទំនិញ ដោយមិនបែងចែកបញ្ចុះតម្លៃប័ណ្ណទូទាត់។ វាមិនមែនជាប្រាក់ទទួលសរុបនៃបញ្ជាទិញទេ។ បង្ហាញតែប្រាក់សងវិញដែលអាចភ្ជាប់នឹងទំនិញបាន។',
    TODAY: 'ថ្ងៃនេះ', YESTERDAY: 'ម្សិលមិញ', WEEK: 'សប្ដាហ៍នេះ', MONTH: 'ខែនេះ', CUSTOM: 'ជ្រើសថ្ងៃ', from: 'ថ្ងៃចាប់ផ្ដើម', to: 'ថ្ងៃបញ្ចប់',
    stores: 'ហាង', allStores: 'ហាងទាំងអស់ដែលមានសិទ្ធិ', products: 'ជ្រើសទំនិញ', search: 'ស្វែងរកឈ្មោះ បាកូដ ឬ SKU', selected: 'ទំនិញដែលបានជ្រើស', more: 'បង្ហាញបន្ថែម', query: 'ស្វែងរក', working: 'កំពុងដំណើរការ…',
    groups: 'ក្រុមទំនិញ', name: 'ឈ្មោះក្រុម', newGroup: 'ក្រុមថ្មី', save: 'រក្សាទុកក្រុមថ្មី', update: 'កែប្រែក្រុម', enabled: 'បើករបាយការណ៍ប្រចាំថ្ងៃស្វ័យប្រវត្តិ', disabled: 'បានបិទ', disable: 'បិទ', history: 'ប្រវត្តិរបាយការណ៍',
    emptyGroups: 'មិនទាន់មានក្រុមទេ។ សូមជ្រើសទំនិញដើម្បីរក្សាទុក។', emptyHistory: 'មិនទាន់មានរបាយការណ៍ទេ។ ក្រុមថ្មីចាប់ផ្ដើមបន្ទាប់ពីថ្ងៃបង្កើតបានបញ្ចប់។', historyNote: 'ត្រូវមានសិទ្ធិចូលហាងទាំងអស់ក្នុងរបាយការណ៍។ លទ្ធផលរក្សាទុកតាមពេលបង្កើត; ទិន្នន័យមកយឺតអាចផ្លាស់ប្ដូរលទ្ធផលស្វែងរកថ្មី។',
    product: 'ទំនិញ', store: 'ហាង', quantity: 'ចំនួនលក់', amount: 'ប្រាក់លក់ទំនិញ', refund: 'ប្រាក់សងវិញតាមទំនិញ', totals: 'សរុបតាមរូបិយប័ណ្ណ', generated: 'ពេលបង្កើត', print: 'បោះពុម្ព', printFailed: 'មិនអាចបញ្ជាក់ការផ្ញើបោះពុម្ពបាន។ សូមពិនិត្យសេវាបោះពុម្ពដែលមានស្រាប់ ហើយព្យាយាមម្ដងទៀត។',
    failed: 'ដំណើរការមិនបាន។ សូមព្យាយាមម្ដងទៀត។', unauthorized: 'តម្រូវឱ្យ OWNER មានសិទ្ធិចូលហាង។', incomplete: 'មានទិន្នន័យទំនិញខ្លះមិនអាចកំណត់បាន ហើយមិនត្រូវបានបូកបញ្ចូល។', refundIncomplete: 'មានប្រាក់សងវិញខ្លះមិនអាចភ្ជាប់នឹងទំនិញបាន។', emptyProducts: 'រកមិនឃើញទំនិញ។', remove: 'ដកចេញ', saved: 'បានរក្សាទុកក្រុម។', noSelection: 'សូមជ្រើសទំនិញពី១ ដល់១០០។', noResult: 'ស្វែងរកដើម្បីមើល និងបោះពុម្ពលទ្ធផល។', conflict: 'ក្រុមនេះត្រូវបានកែប្រែ។ សូមផ្ទុកឡើងវិញ។', invalid: 'សូមពិនិត្យថ្ងៃ ទំនិញ និងទិន្នន័យប្រវត្តិ។',
  },
} as const
export type ReportLang = keyof typeof COPY
export function printError(code: string, lang: ReportLang): string {
  const copy = COPY[lang]
  if (code === 'PRINT_TOO_LARGE') return copy.printTooLarge
  if (code === 'PRINT_PREPARE_TIMEOUT') return copy.printPrepareTimeout
  if (code === 'PRINT_PREPARE_FAILED') return copy.printPrepareFailed
  if (code === 'PRINT_SEND_TIMEOUT') return copy.printSendTimeout
  if (code.startsWith('PRINT_BROWSER_')) return `${copy.printBrowserFailed} (${code})`
  return copy.printFailed
}
export function displayError(code: string, lang: ReportLang) {
  const copy = COPY[lang]
  if (['MISSING_CONTEXT', 'FORBIDDEN', 'STORE_ACCESS_DENIED', 'OWNER_TELEGRAM_IDENTITY_REQUIRED', 'PRODUCT_ACCESS_DENIED'].includes(code)) return copy.unauthorized
  if (['GROUP_CHANGED', 'REQUEST_CONFLICT'].includes(code)) return copy.conflict
  if (code === 'SELECT_1_TO_100_PRODUCTS') return copy.noSelection
  if (code.startsWith('INVALID') || code.startsWith('INCOMPLETE') || code === 'PRODUCT_UNAVAILABLE' || code === 'QUERY_TOO_LARGE') return `${copy.invalid} (${code})`
  return copy.failed
}
