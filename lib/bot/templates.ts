/**
 * lib/bot/templates.ts — 顾客 bot 三语模板池（私域助手风格）。
 *
 * 风格统一：温柔、不冷硬、≤4 行、≤200 字、emoji ≤ 2。
 * 模板池每条 ≥ 2 个变体，运行时随机选避免重复感。
 *
 * 变量占位：{store} 门店名 / {url} 链接 / {no} 短订单号 / {status} 状态短语 / {total} 金额
 */

import type { Lang, ChatKind } from './intent'

type LangPool<T> = Record<Lang, T>
type ChatPool   = LangPool<string[]>
type SingleTpl  = LangPool<string>

export const TPL = {
  chat: {
    GREETING: {
      zh: [
        '您好～有什么可以帮到您的吗？❤️',
        '您来啦！想看看今天的菜单吗？/menu',
        '您好，我是 {store} 的小助手，随时为您服务～',
      ],
      en: [
        "Hi! How can I help you today? ❤️",
        "Hello! Want to take a look at the menu today?",
        "Hi, I'm the assistant for {store}. I'm here whenever you need me.",
      ],
      km: [
        'សួស្តី! តើខ្ញុំអាចជួយអ្នកយ៉ាងណាបាន? ❤️',
        'សួស្តី! តើអ្នកចង់មើលម៉ឺនុយថ្ងៃនេះទេ?',
        'សួស្តី ខ្ញុំជាជំនួយការរបស់ {store} នៅពេលដែលអ្នកត្រូវការខ្ញុំ',
      ],
    } as ChatPool,
    THANKS: {
      zh: ['不客气～祝您一切顺利 🌟', '应该的，您满意我就开心 ❤️'],
      en: ["You're very welcome — have a great day! 🌟", "Glad to help. Take care! ❤️"],
      km: ['មិនអីទេ! សូមឱ្យអ្នកមានសុភមង្គល 🌟', 'រីករាយដែលបានជួយ ❤️'],
    } as ChatPool,
    BYE: {
      zh: ['再见～有需要随时找我 👋', '回头见，祝您愉快 ❤️'],
      en: ['Bye! Reach out anytime 👋', 'See you! Have a good one ❤️'],
      km: ['លាហើយ! សូមមកវិញពេលណាក៏បាន 👋', 'រាត្រីសួស្តី ❤️'],
    } as ChatPool,
    WHO: {
      zh: [
        '我是 {store} 的小助手，能帮您查订单、商品、优惠券 ❤️',
        '您好，我是 {store} 的客服助手，有问题随时问我～',
      ],
      en: [
        "I'm the assistant for {store}. I can help with orders, products, and coupons ❤️",
        "Hi, I'm {store}'s helper bot — ask me anything anytime.",
      ],
      km: [
        'ខ្ញុំជាជំនួយការរបស់ {store} អាចជួយរឿងបញ្ជាទិញ ផលិតផល និងគូប៉ុង ❤️',
        'សួស្តី ខ្ញុំជាជំនួយការ {store} សួរបានគ្រប់ពេល',
      ],
    } as ChatPool,
    OK: {
      zh: ['好的～有需要随时找我 ❤️', '收到，祝您愉快 🌟'],
      en: ['Got it — let me know if you need anything else ❤️', 'Sure thing 🌟'],
      km: ['យល់ហើយ ❤️ សួរទៀតបាន', 'អូខេ 🌟'],
    } as ChatPool,
  } satisfies Record<ChatKind, ChatPool>,

  // 第三层：转人工三段话
  escalate: {
    GENERIC: {
      zh: '非常抱歉给您带来不便 🙏 我已通知商家尽快与您联系～',
      en: 'Sorry for the trouble 🙏 I have notified the merchant — they will reach out shortly.',
      km: 'សុំទោសចំពោះការរំខាន 🙏 ខ្ញុំបានជូនដំណឹងហាង គេនឹងទាក់ទងអ្នកក្នុងពេលឆាប់ៗ។',
    } as SingleTpl,
    REFUND_LIKE: {
      zh: '听到您说退款/订单异常，我已经把您的消息转给商家了 🙏 请稍候联系～',
      en: 'I see this is about a refund or order issue. I have forwarded your message to the merchant 🙏',
      km: 'ខ្ញុំឃើញថាជាបញ្ហាសងលុយ / បញ្ជាទិញ ខ្ញុំបានបញ្ជូនទៅហាងហើយ 🙏',
    } as SingleTpl,
    UNKNOWN: {
      zh: '这个我暂时帮不上 🙏 已经记下，商家会很快回复您～',
      en: "Sorry, I can't handle this one yet 🙏 I have noted it — the merchant will follow up soon.",
      km: 'សុំទោស ខ្ញុំមិនអាចជួយផ្នែកនេះបាននៅឡើយ 🙏 ខ្ញុំបានកត់ត្រា គេនឹងឆ្លើយតបឆាប់ៗ។',
    } as SingleTpl,
    // OWNER 收到的告警
    OWNER_ALERT: {
      zh: '⚠️ 顾客求助\n顾客 TG: {tg}\n语言: {lang}\n来源: {source}\n原文: {text}',
      en: '⚠️ Customer help request\nCustomer TG: {tg}\nLang: {lang}\nSource: {source}\nMessage: {text}',
      km: '⚠️ អតិថិជនសុំជំនួយ\nអតិថិជន TG: {tg}\nភាសា: {lang}\nប្រភព: {source}\nសារ: {text}',
    } as SingleTpl,
  },

  // 第一层：业务回退/默认文案（订单短卡片由 business handler 自渲染）
  business: {
    MENU_LINK: {
      zh: '看看菜单吧～ {url}',
      en: 'Here is the menu: {url}',
      km: 'នេះជាម៉ឺនុយ: {url}',
    } as SingleTpl,
    PRODUCT_HINT: {
      zh: '想看具体商品和价格，可以打开菜单看一下哦～{url}',
      en: 'You can browse products and prices on the menu: {url}',
      km: 'អ្នកអាចមើលផលិតផល និងតម្លៃនៅម៉ឺនុយ: {url}',
    } as SingleTpl,
    COUPON_HINT: {
      zh: '您的优惠券都在这里：{url} ❤️',
      en: 'Your coupons are here: {url} ❤️',
      km: 'គូប៉ុងរបស់អ្នកនៅទីនេះ: {url} ❤️',
    } as SingleTpl,
    HOURS_HINT: {
      zh: '关于营业时间，您可以在菜单页查看，或留言我转商家 ❤️ {url}',
      en: 'For business hours, please check the menu page or leave a note for the merchant ❤️ {url}',
      km: 'សម្រាប់ម៉ោងបើក សូមមើលនៅទំព័រម៉ឺនុយ ឬផ្ញើសារទុក ❤️ {url}',
    } as SingleTpl,
    ADDRESS_HINT: {
      zh: '门店地址在菜单页可以看到～ {url}',
      en: 'You can find the store address on the menu page: {url}',
      km: 'អាសយដ្ឋានហាងនៅទំព័រម៉ឺនុយ: {url}',
    } as SingleTpl,
    DELIVERY_HINT: {
      zh: '配送/自取规则请以菜单页为准～ {url}',
      en: 'Please check the menu page for delivery / pickup details: {url}',
      km: 'សូមមើលលម្អិតការដឹកជញ្ជូន / ការមករកនៅទំព័រម៉ឺនុយ: {url}',
    } as SingleTpl,
    ORDER_STATUS_NEED_NO: {
      zh: '想查订单，发您的订单号给我哦～ 比如 #0017 ❤️',
      en: 'To check an order, send me the order number, e.g. #0017 ❤️',
      km: 'ដើម្បីពិនិត្យបញ្ជាទិញ សូមផ្ញើលេខបញ្ជាទិញ ឧ. #0017 ❤️',
    } as SingleTpl,
    ORDER_STATUS_NOT_FOUND: {
      zh: '没有找到这笔订单，您可以在「我的订单」里查看：{url}',
      en: "I couldn't find that order. You can check 'My Orders' here: {url}",
      km: 'រកមិនឃើញការបញ្ជាទិញនោះ អ្នកអាចមើល "ការបញ្ជាទិញរបស់ខ្ញុំ" នៅទីនេះ: {url}',
    } as SingleTpl,
    // 订单状态短语（与 customer-orders 通知一致风格）
    STATUS_PHRASE: {
      PENDING:   { zh: '正在处理中 ✨', en: 'Being prepared ✨', km: 'កំពុងដំណើរការ ✨' } as SingleTpl,
      CONFIRMED: { zh: '正在处理中 ✨', en: 'Being prepared ✨', km: 'កំពុងដំណើរការ ✨' } as SingleTpl,
      READY:     { zh: '已准备完成 🎉', en: 'Ready 🎉', km: 'បានរៀបចំរួចរាល់ 🎉' } as SingleTpl,
      COMPLETED: { zh: '已准备完成 🎉', en: 'Ready 🎉', km: 'បានរៀបចំរួចរាល់ 🎉' } as SingleTpl,
      CANCELLED: { zh: '未能完成 🙏',   en: 'Could not be completed 🙏', km: 'មិនអាចបញ្ចប់បាន 🙏' } as SingleTpl,
    },
  },

  // 第四层：语音 / 非文本媒体兜底
  voice: {
    zh: '为方便准确回复，请用文字描述一下您的需求～❤️',
    en: 'To help you more accurately, please type your question in text ❤️',
    km: 'សូមវាយជាអក្សរ ដើម្បីឱ្យខ្ញុំជួយបានច្បាស់លាស់ ❤️',
  } as SingleTpl,
  media: {
    PHOTO: {
      zh: '主人，我已收到图片 ❤️ 为了更准确帮助您，麻烦用文字描述一下您的问题哦～',
      en: 'Got your photo ❤️ To help you better, please describe your question in text.',
      km: 'ខ្ញុំបានទទួលរូបភាពហើយ ❤️ សូមរៀបរាប់ជាអក្សរ ដើម្បីខ្ញុំជួយបានច្បាស់ជាង។',
    } as SingleTpl,
    STICKER: {
      zh: '收到您的消息啦 😊 有任何商品、订单或优惠问题都可以直接告诉我～',
      en: "Got it 😊 Feel free to ask me about products, orders, or coupons anytime.",
      km: 'ទទួលបានហើយ 😊 សួរអំពីផលិតផល បញ្ជាទិញ ឬគូប៉ុងបានគ្រប់ពេល។',
    } as SingleTpl,
    LOCATION: {
      zh: '主人，已收到您的位置 📍 如需配送或地址帮助，请告诉我您的需求～',
      en: 'Got your location 📍 If you need delivery or address help, please let me know.',
      km: 'ខ្ញុំបានទទួលទីតាំងរបស់អ្នកហើយ 📍 ប្រាប់ខ្ញុំបើត្រូវការដឹកជញ្ជូន ឬជំនួយអាសយដ្ឋាន។',
    } as SingleTpl,
    CONTACT: {
      zh: '主人，已收到您分享的联系方式 ❤️ 请用文字告诉我您的需求，我会尽快帮您～',
      en: 'Got the contact info you shared ❤️ Please describe your need in text and I will help.',
      km: 'ខ្ញុំបានទទួលព័ត៌មានទំនាក់ទំនងហើយ ❤️ សូមរៀបរាប់ជាអក្សរ ខ្ញុំនឹងជួយ។',
    } as SingleTpl,
    DOCUMENT: {
      zh: '主人，我暂时无法直接处理文件 📄 您可以发送文字说明，我会尽力帮您～',
      en: "I can't open documents directly 📄 Please send a text description and I'll do my best.",
      km: 'ខ្ញុំមិនអាចបើកឯកសារដោយផ្ទាល់បាននៅឡើយ 📄 សូមផ្ញើជាអក្សរ ខ្ញុំនឹងព្យាយាមជួយ។',
    } as SingleTpl,
    UNSUPPORTED: {
      zh: '主人，我先帮您记录啦 ❤️ 麻烦用文字告诉我您的需求会更快哦～',
      en: "I've noted your message ❤️ Sending it in text will help me respond faster.",
      km: 'ខ្ញុំបានកត់ត្រាហើយ ❤️ បើផ្ញើជាអក្សរ ខ្ញុំអាចឆ្លើយឆាប់ជាង។',
    } as SingleTpl,
  },
} as const

export function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

export function fill(tpl: string, vars: Record<string, string | undefined>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
}
