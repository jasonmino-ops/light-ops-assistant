import assert from 'node:assert/strict'
import fs from 'node:fs'
import en from '../lib/i18n/en'
import km from '../lib/i18n/km'
import zh from '../lib/i18n/zh'
import {
  getBindTokenFromStartParam,
  getOpenApplicationTokenFromStartParam,
} from '../lib/telegram-start-param'

const rawToken = 'abcdefghijklmnopqrstuv'
assert.equal(getOpenApplicationTokenFromStartParam('open'), '')
assert.equal(getOpenApplicationTokenFromStartParam(`open_${rawToken}`), rawToken)
assert.equal(getOpenApplicationTokenFromStartParam(`bind_${rawToken}`), '')
assert.equal(getBindTokenFromStartParam(`open_${rawToken}`), '')
assert.equal(getBindTokenFromStartParam(`bind_${rawToken}`), rawToken)

assert.deepEqual(Object.keys(zh.open), Object.keys(en.open))
assert.deepEqual(Object.keys(zh.open), Object.keys(km.open))

const telegramInit = fs.readFileSync('app/components/TelegramInit.tsx', 'utf8')
const openApi = fs.readFileSync('app/api/open/route.ts', 'utf8')
const openPage = fs.readFileSync('app/open/page.tsx', 'utf8')
const migration = fs.readFileSync('prisma/migrations/20260819083000_add_sales_lead_attribution_v01/migration.sql', 'utf8')

assert.match(telegramInit, /preAuthIsLegacyOpen/)
assert.match(telegramInit, /getOpenApplicationTokenFromStartParam/)
assert.match(telegramInit, /sp === 'open' \|\| openApplicationToken/)
assert.match(telegramInit, /getBindTokenFromStartParam/)
assert.match(openApi, /verifyTgInitData\(initData, BOT_TOKEN\)/)
assert.match(openApi, /salesLeadPhonesMatch\(phone\.normalizedPhone, context\.salesLead\.normalizedPhone\)/)
assert.match(openApi, /consumedByTelegramId: applicant\.telegramId/)
assert.match(openApi, /OR: \[\{ telegramId: null \}, \{ telegramId: applicant\.telegramId \}\]/)
assert.match(openApi, /action === 'CLAIM'/)
assert.match(openApi, /action === 'APPLY'/)
assert.match(openApi, /firstSourceChannel: 'DIRECT_TELEGRAM'/)
assert.match(openApi, /pg_advisory_xact_lock/)
assert.match(openApi, /error\.code === 'P2002'/)
assert.ok(
  openApi.indexOf('const idempotentPending') < openApi.indexOf("action: 'APPLICATION_SUBMIT'"),
  'existing PENDING must be returned before consuming an application-submit rate slot',
)
assert.match(migration, /StoreApplication_one_pending_per_telegram/)
assert.match(openPage, /action: 'CLAIM'/)
assert.match(openPage, /action: 'APPLY'/)
assert.match(openPage, /action: 'STATUS'/)
assert.match(openPage, /navigator\.geolocation/)
assert.doesNotMatch(openPage, /phone=.*applicationToken|ownerName=.*applicationToken/)

console.log('sales lead telegram claim tests passed')
