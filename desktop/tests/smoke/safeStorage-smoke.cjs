const { app, safeStorage } = require('electron')

app.whenReady().then(() => {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.error('FAIL')
      app.exit(1)
      return
    }
    const encrypted = safeStorage.encryptString('round-trip-check')
    const decrypted = safeStorage.decryptString(encrypted)
    if (decrypted !== 'round-trip-check') {
      console.error('FAIL')
      app.exit(1)
      return
    }
    console.log('PASS')
    app.exit(0)
  } catch {
    console.error('FAIL')
    app.exit(1)
  }
}).catch(() => {
  console.error('FAIL')
  app.exit(1)
})
