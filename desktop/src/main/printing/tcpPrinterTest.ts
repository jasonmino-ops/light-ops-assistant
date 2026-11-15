import { createHash, randomUUID } from 'node:crypto'
import net from 'node:net'
import type { PrinterRole } from './localEndpointAuthority'
import { RawTcpEffectBoundary, type TcpSocket } from './rawTcpEffectBoundary'
import { sameTcpDiagnosticTarget, type ProveTcpDiagnosticTarget, type TcpDiagnosticTarget } from './tcpDiagnosticTarget'
import type { ExecutionSafetyCheck, PrintingEffectBoundary, SharedPrintingCore } from './sharedPrintingCore'

type DiagnosticSocket = TcpSocket & Pick<net.Socket, 'localAddress' | 'remoteAddress' | 'remotePort'>
type DiagnosticDial = (options: { host: string; port: number; family: 4; localAddress: string }) => DiagnosticSocket

export function createTcpDiagnosticBoundary(
  target: TcpDiagnosticTarget, prove: ProveTcpDiagnosticTarget, timeoutMs: number,
  dial: DiagnosticDial = (options) => net.createConnection(options),
): PrintingEffectBoundary<Uint8Array> {
  return { cross: (input) => {
    let socket: DiagnosticSocket | undefined
    const deadline = performance.now() + timeoutMs
    const raw = new RawTcpEffectBoundary(timeoutMs, (endpoint) => {
      if (endpoint.host !== target.host || endpoint.port !== target.port) throw new Error('TCP_TEST_TARGET_CHANGED')
      socket = dial({ ...endpoint, family: 4, localAddress: target.localAddress })
      return socket
    })
    return raw.cross({ ...input, validateExecution: async () => {
      const reject = (code: string) => ({ ok: false as const, error: { code, message: 'TCP test pre-write validation failed.' } })
      if (socket?.localAddress !== target.localAddress || socket?.remoteAddress !== target.host || socket?.remotePort !== target.port) {
        return reject('TCP_TEST_TARGET_CHANGED')
      }
      const budget = Math.min(5000, Math.floor(deadline - performance.now()) - 50)
      if (budget < 1) return reject('TCP_TEST_PROOF_TIMEOUT')
      const current = await prove({ host: target.host, port: target.port }, budget)
      if (!sameTcpDiagnosticTarget(target, current)) return reject('TCP_TEST_TARGET_CHANGED')
      const admission = await input.validateExecution()
      return performance.now() < deadline ? admission : reject('TCP_TEST_PROOF_TIMEOUT')
    } })
  } }
}

export function makeTcpTestIdentity(role: PrinterRole, now = Date.now()) {
  return { printJobId: `tcp-printer-test:${role}:${now}:${randomUUID()}`, expiresAt: new Date(now + 5 * 60_000).toISOString() }
}

export function executeTcpPrinterTest(
  core: SharedPrintingCore<Uint8Array>, role: PrinterRole, target: TcpDiagnosticTarget, revision: number,
  request: ReturnType<typeof makeTcpTestIdentity>, validateExecution: ExecutionSafetyCheck,
) {
  const endpointKey = `${target.host}:${target.port}`
  const payload = Buffer.concat([
    Buffer.from([0x1b, 0x40]),
    Buffer.from(`E-Shop TCP ${role} TEST - NO SALE\n${request.printJobId}\n\n\n`, 'ascii'),
  ])
  const requestHash = createHash('sha256')
    .update(JSON.stringify([role, revision, endpointKey, target.localAddress, target.network, target.mac]))
    .update('\0').update(payload).digest('hex')
  return core.execute({
    identity: { ...request, requestHash, rendererVersion: 'tcp-printer-test-v1' },
    endpointKey,
    payload,
    validateExecution,
    onDurableBarrier: async () => ({ ok: true, value: undefined }),
  })
}
