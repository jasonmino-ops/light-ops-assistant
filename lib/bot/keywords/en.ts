/**
 * 顾客 bot English keyword lists for intent.ts.
 * Lowercased; matched against lowercased message text.
 */

export const RISK_KEYWORDS_EN = [
  'refund', 'return', 'cancel order', 'chargeback',
  'complaint', 'complain', 'report', 'scam', 'fraud',
  'not received', "didn't receive", 'missing', 'wrong order', 'wrong item',
  'fake', 'expired', 'broken', 'damaged',
  'overcharged', 'double charged', 'charged twice',
  'police', 'court',
  'bank card', 'credit card', 'id card', 'passport',
  'human', 'agent', 'staff please', 'real person',
] as const

export const BIZ_KEYWORDS_EN: Record<string, string[]> = {
  ORDER_STATUS: ['order status', 'my order', 'order #', 'where is my order', 'track'],
  PRODUCT:      ['product', 'item', 'do you have', 'do you sell', 'recommend'],
  PRICE:        ['price', 'how much', 'cost', 'cheap', 'expensive'],
  COUPON:       ['coupon', 'voucher', 'discount', 'promo', 'deal'],
  HOURS:        ['open', 'close', 'hours', 'business hours', 'when do you'],
  ADDRESS:      ['address', 'where', 'location', 'directions'],
  DELIVERY:     ['delivery', 'shipping', 'pickup', 'pick up', 'deliver'],
  MENU_LINK:    ['menu', 'order online', 'place order', 'how to buy'],
}

export const CHAT_KEYWORDS_EN = {
  GREETING: ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening', 'are you there'],
  THANKS:   ['thanks', 'thank you', 'thx', 'tysm', 'appreciate'],
  BYE:      ['bye', 'goodbye', 'see you', 'good night'],
  WHO:      ['who are you', 'what are you', 'are you a bot', 'are you ai'],
  OK:       ['ok', 'okay', 'got it', 'sure', 'alright', 'noted'],
} as const
