export const IMAGE_COPY = {
  zh: {
    quantity: '数量', total: '合计', zeroSales: '未显示：{count} 个零销售商品',
    title: '商品销售报表', generate: '生成图片', preview: '报表图片预览', close: '关闭', generating: '正在生成图片…',
    download: '下载 / 保存', share: '分享图片', sharing: '正在打开分享…', saveHint: '可下载图片；手机也可长按预览图保存。',
    unavailable: '当前浏览器不支持文件分享，可先保存图片再分享。', downloaded: '已请求保存，请在浏览器中确认下载或保存。', shared: '已完成系统分享。', cancelled: '已取消分享。',
    failed: '图片生成失败，请重试。', timeout: '图片生成超时，请重试。', large: '报表过长，无法完整生成一张清晰图片。请缩小查询范围后重试。',
    downloadFailed: '未能打开保存，请长按图片保存，或更换支持下载的浏览器。', shareFailed: '分享未完成，请重试，或先保存图片。',
    sharePending: '系统分享尚未返回结果。请完成或关闭系统分享后重试，也可保存图片。',
  },
  en: {
    quantity: 'Qty', total: 'Total', zeroSales: 'Products with no sales (not shown): {count}',
    title: 'Product sales report', generate: 'Generate image', preview: 'Report image preview', close: 'Close', generating: 'Generating image…',
    download: 'Download / save', share: 'Share image', sharing: 'Opening sharing…', saveHint: 'Download the image, or touch and hold the preview to save on mobile.',
    unavailable: 'File sharing is unavailable in this browser. Save the image to share it.', downloaded: 'Save requested. Confirm the download or save in your browser.', shared: 'System sharing completed.', cancelled: 'Sharing cancelled.',
    failed: 'Could not generate the image. Please retry.', timeout: 'Image generation timed out. Please retry.', large: 'This report is too long for one complete, readable image. Query a smaller range and retry.',
    downloadFailed: 'Could not open saving. Touch and hold the image, or use a browser that supports downloads.', shareFailed: 'Sharing did not complete. Retry, or save the image first.',
    sharePending: 'System sharing has not returned a result. Finish or close it before retrying. You can also save the image.',
  },
  km: {
    quantity: 'ចំនួន', total: 'សរុប', zeroSales: 'មិនបង្ហាញ៖ ទំនិញ {count} មុខគ្មានការលក់',
    title: 'របាយការណ៍លក់ទំនិញ', generate: 'បង្កើតរូបភាព', preview: 'មើលរូបភាពរបាយការណ៍', close: 'បិទ', generating: 'កំពុងបង្កើតរូបភាព…',
    download: 'ទាញយក / រក្សាទុក', share: 'ចែករំលែករូបភាព', sharing: 'កំពុងបើកការចែករំលែក…', saveHint: 'អាចទាញយករូបភាព ឬចុចរូបភាពឱ្យជាប់ដើម្បីរក្សាទុកលើទូរសព្ទ។',
    unavailable: 'កម្មវិធីរុករកនេះមិនគាំទ្រការចែករំលែកឯកសារ។ សូមរក្សាទុករូបភាពសិន។', downloaded: 'បានស្នើរក្សាទុក។ សូមបញ្ជាក់ក្នុងកម្មវិធីរុករក។', shared: 'បានបញ្ចប់ការចែករំលែកតាមប្រព័ន្ធ។', cancelled: 'បានបោះបង់ការចែករំលែក។',
    failed: 'មិនអាចបង្កើតរូបភាពបាន។ សូមព្យាយាមម្ដងទៀត។', timeout: 'ការបង្កើតរូបភាពហួសពេលកំណត់។ សូមព្យាយាមម្ដងទៀត។', large: 'របាយការណ៍វែងពេកសម្រាប់រូបភាពច្បាស់មួយ។ សូមបន្ថយរយៈពេលស្វែងរក ហើយព្យាយាមម្ដងទៀត។',
    downloadFailed: 'មិនអាចបើកការរក្សាទុកបាន។ សូមចុចរូបភាពឱ្យជាប់ ឬប្រើកម្មវិធីរុករកដែលគាំទ្រការទាញយក។', shareFailed: 'ការចែករំលែកមិនបានបញ្ចប់។ សូមព្យាយាមម្ដងទៀត ឬរក្សាទុករូបភាពសិន។',
    sharePending: 'ការចែករំលែកតាមប្រព័ន្ធមិនទាន់ផ្តល់លទ្ធផល។ សូមបញ្ចប់ ឬបិទវាមុនព្យាយាមម្ដងទៀត។ អ្នកអាចរក្សាទុករូបភាពបាន។',
  },
} as const
