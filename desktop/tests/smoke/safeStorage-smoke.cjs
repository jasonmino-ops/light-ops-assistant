const { app, safeStorage } = require('electron')

let isExiting = false

function writeAndExit(lines, code) {
  if (isExiting) {
    return
  }
  isExiting = true
  const output = Array.isArray(lines) ? lines.join('\n') : lines
  process.stdout.write(`${output}\n`, () => {
    app.exit(code)
  })
}

function safeErrorName(error) {
  if (!error || typeof error !== 'object' || typeof error.name !== 'string') {
    return 'Error'
  }
  const name = error.name.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64)
  return name || 'Error'
}

function fail(stage, error) {
  writeAndExit([
    'RESULT=FAIL',
    `ERROR_STAGE=${stage}`,
    `ERROR_NAME=${safeErrorName(error)}`,
  ], 1)
}

process.stdout.write('PHASE=SCRIPT_START\n')

app.whenReady().then(() => {
  process.stdout.write('PHASE=APP_READY\n')

  let encryptionAvailable = false
  try {
    encryptionAvailable = safeStorage.isEncryptionAvailable()
  } catch (error) {
    fail('ENCRYPTION_UNAVAILABLE', error)
    return
  }

  process.stdout.write(`ENCRYPTION_AVAILABLE=${encryptionAvailable ? 'true' : 'false'}\n`)
  if (!encryptionAvailable) {
    fail('ENCRYPTION_UNAVAILABLE')
    return
  }

  let sealedValue
  try {
    sealedValue = safeStorage.encryptString('round-trip-check')
    process.stdout.write('PHASE=ENCRYPT_OK\n')
  } catch (error) {
    fail('ENCRYPT', error)
    return
  }

  let openedValue
  try {
    openedValue = safeStorage.decryptString(sealedValue)
    process.stdout.write('PHASE=DECRYPT_OK\n')
  } catch (error) {
    fail('DECRYPT', error)
    return
  }

  if (openedValue !== 'round-trip-check') {
    fail('ROUNDTRIP_MISMATCH')
    return
  }

  process.stdout.write('PHASE=ROUNDTRIP_OK\n')
  writeAndExit('RESULT=PASS', 0)
}).catch((error) => {
  fail('APP_READY', error)
})
