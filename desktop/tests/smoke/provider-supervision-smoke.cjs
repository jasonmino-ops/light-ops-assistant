const { WindowsProviderSupervisor } = require('../../dist/main/provider/providerSupervisor')
const { getHealthSnapshot } = require('../../dist/main/runtimeHealth')

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitForReady(previousPid = null) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const runtime = getHealthSnapshot().providerRuntime
    if (runtime.state === 'ok' && runtime.pid && runtime.pid !== previousPid) return runtime
    await wait(250)
  }
  throw new Error(`Provider did not reach READY: ${JSON.stringify(getHealthSnapshot().providerRuntime)}`)
}

async function main() {
  if (!process.versions.electron || process.env.ELECTRON_RUN_AS_NODE === '1') {
    throw new Error('Provider supervision smoke must run in the Electron main runtime')
  }

  const supervisor = new WindowsProviderSupervisor({
    pipeSuffix: `ci-${process.pid}`,
    connectDelayMs: 500,
  })
  try {
    await supervisor.start()
    const first = await waitForReady()
    process.kill(first.pid)
    const recovered = await waitForReady(first.pid)
    await supervisor.stop()
    await wait(1_500)
    const stopped = getHealthSnapshot().providerRuntime
    if (stopped.state !== 'closed' || stopped.pid !== null) {
      throw new Error(`Provider respawned after shutdown: ${JSON.stringify(stopped)}`)
    }
    console.log(JSON.stringify({ first, recovered, stopped }))
    console.log('RESULT=PASS')
  } finally {
    await supervisor.stop()
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  },
)
