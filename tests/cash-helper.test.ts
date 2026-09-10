import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cashHelperQuote, acceptCashInput, editCashInput } from '../app/components/CashTenderPanel'

for (const [currency, received, change, sufficient] of [
  ['USD','10','$2.70',true], ['USD','7.30','$0.00',true], ['USD','7.29','$0.00',false],
  ['KHR','29930','៛0',true], ['KHR','30000','៛70',true], ['KHR','50000','៛20,070',true], ['KHR','20000','៛0',false],
] as const) test(`${currency} 7.30, rate4100, received ${received} -> ${change}`, () => {
  const quote = cashHelperQuote(7.30,4100,currency,received)!
  assert.equal(quote.usdDue,'$7.30'); assert.equal(quote.khrDue,'៛29,930')
  assert.equal(quote.change,change); assert.equal(quote.sufficient,sufficient)
})

test('uses supplied device rate with explicit integer half-up rounding', () => {
  assert.equal(cashHelperQuote(7.30,4000,'KHR','30000')!.change,'៛800')
  assert.equal(cashHelperQuote(0.01,4050,'KHR','41')!.due,BigInt(41))
  assert.equal(cashHelperQuote(0.01,4049,'KHR','41')!.due,BigInt(40))
  assert.equal(cashHelperQuote(0.1+0.2,4100,'KHR','1230')!.change,'៛0')
})
for (const currency of ['USD','KHR'] as const) {
  for (const value of ['-1','1e5','NaN','Infinity',' 10','1,000','a','1.2.3','99999999999999999']) {
    test(`${currency} rejects invalid input ${value}`, () => {
      assert.equal(acceptCashInput(value,currency),false)
      assert.equal(cashHelperQuote(7.30,4100,currency,value)!.sufficient,false)
    })
  }
}
test('KHR decimals and USD fractional cents cannot be confirmed', () => {
  assert.equal(acceptCashInput('30000.0','KHR'),false)
  assert.equal(acceptCashInput('7.301','USD'),false)
  for (const value of ['','10.']) assert.equal(cashHelperQuote(7.30,4100,'USD',value)!.sufficient,false)
})
test('USD dot, cents, backspace, clear, leading zero; no second amount state', () => {
  let value = ''
  for (const key of ['7','.','3','0']) value = editCashInput(value,key,'USD')
  assert.equal(value,'7.30')
  assert.equal(editCashInput(value,'.','USD'),value)
  assert.equal(editCashInput(value,'0','USD'),value)
  assert.equal(editCashInput(value,'backspace','USD'),'7.3')
  assert.equal(editCashInput(value,'clear','USD'),'')
  assert.equal(editCashInput('','backspace','USD'),'')
  assert.equal(editCashInput('','.','USD'),'0.')
  assert.equal(editCashInput('0','8','USD'),'8')
  assert.equal(editCashInput('7','.','KHR'),'7')
})
test('invalid order or rate cannot authorize helper confirmation', () => {
  for (const amount of [-1,NaN,Infinity,1e30]) assert.equal(cashHelperQuote(amount,4100,'USD','10'),null)
  for (const rate of [NaN,Infinity,999,10001,4100.5]) assert.equal(cashHelperQuote(7.30,rate,'KHR','50000'),null)
})
