import assert from 'node:assert/strict'
import {
  getBindTokenFromStartParam,
  redactStartParam,
  resolveTelegramStartParam,
} from '../lib/telegram-start-param'

const token = 'bind_abcdef123456'

assert.equal(
  resolveTelegramStartParam({
    initDataUnsafeStartParam: token,
    hash: '#tgWebAppStartParam=bind_hash',
    search: '?startapp=bind_query',
  })?.source,
  'initDataUnsafe.start_param',
)

assert.deepEqual(
  resolveTelegramStartParam({ hash: '#tgWebAppStartParam=bind_hash' }),
  { value: 'bind_hash', raw: 'bind_hash', source: 'tgWebAppStartParam' },
)

assert.equal(
  resolveTelegramStartParam({ search: '?startapp=bind_query' })?.value,
  'bind_query',
)

assert.equal(
  resolveTelegramStartParam({ search: '?start_param=bind_legacy' })?.source,
  'query.start_param',
)

assert.equal(
  resolveTelegramStartParam({ search: `?startapp=${encodeURIComponent(token)}` })?.value,
  token,
)

assert.equal(resolveTelegramStartParam({ search: '?foo=bar' }), null)
assert.equal(getBindTokenFromStartParam(token), 'abcdef123456')
assert.equal(getBindTokenFromStartParam('open'), '')
assert.equal(redactStartParam(token), 'bind_abcdef...len12')

console.log('telegram-start-param tests passed')
