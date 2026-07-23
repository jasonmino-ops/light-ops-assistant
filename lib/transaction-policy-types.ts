export const POS_DEVICE_OPERATIONS = [
  'POS_SALE_CREATE',
  'POS_MEMBER_BALANCE_PAY',
  'POS_OFFLINE_SYNC',
  'POS_ORDER_UPDATE',
  'POS_ORDERS_READ',
  'POS_RECEIPT_READ',
  'POS_RECORDS_READ',
] as const

export type PosDeviceOperation = (typeof POS_DEVICE_OPERATIONS)[number]

export const PERSONNEL_TRANSACTION_OPERATIONS = [
  'SALE_WRITE',
  'ORDER_CHECKOUT',
  'ORDER_CANCEL',
  'PAYMENT_CONFIRM',
  'PAYMENT_CANCEL',
  'CUSTOMER_ORDER_UPDATE',
  'MEMBER_BALANCE_ADJUST',
  'MEMBER_BALANCE_RECHARGE',
  'MEMBER_IMPORT_CONFIRM',
] as const

export type PersonnelTransactionOperation = (typeof PERSONNEL_TRANSACTION_OPERATIONS)[number]
export type TransactionOperation = PosDeviceOperation | PersonnelTransactionOperation

export function isPosDeviceOperation(value: string): value is PosDeviceOperation {
  return (POS_DEVICE_OPERATIONS as readonly string[]).includes(value)
}

export function isPersonnelTransactionOperation(value: string): value is PersonnelTransactionOperation {
  return (PERSONNEL_TRANSACTION_OPERATIONS as readonly string[]).includes(value)
}
