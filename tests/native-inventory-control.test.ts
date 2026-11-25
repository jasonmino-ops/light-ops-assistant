import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

test('native inventory control: isolated migration, HTTP, ledger and browser acceptance', { timeout: 180000 }, () => {
  execFileSync('python3', ['tests/native-inventory-control/run.py'], {
    cwd: process.cwd(), env: process.env, timeout: 170000, maxBuffer: 4 * 1024 * 1024,
  })
})
