import net from "node:net";
import type { PrintingEffectBoundary, EffectBoundaryResult, ExecutionSafetyCheck } from "./sharedPrintingCore";

export type TcpSocket = Pick<net.Socket, "once" | "write" | "end" | "destroy" | "setTimeout">;
export type TcpSocketFactory = (options: { host: string; port: number }) => TcpSocket;

function parseEndpoint(endpointKey: string): { host: string; port: number } | null {
  const separator = endpointKey.lastIndexOf(":");
  const host = endpointKey.slice(0, separator);
  const port = Number(endpointKey.slice(separator + 1));
  return separator > 0 && host.length > 0 && Number.isInteger(port) && port > 0 && port <= 65535
    ? { host, port }
    : null;
}

export class RawTcpEffectBoundary implements PrintingEffectBoundary<Uint8Array> {
  public constructor(
    private readonly timeoutMs: number,
    private readonly createSocket: TcpSocketFactory = (options) => net.createConnection(options),
  ) {}

  public cross(input: {
    endpointKey: string;
    payload: Uint8Array;
    validateExecution: ExecutionSafetyCheck;
  }): Promise<EffectBoundaryResult> {
    const endpoint = parseEndpoint(input.endpointKey);
    if (!endpoint || input.payload.byteLength === 0) {
      return Promise.resolve({ outcome: "UNKNOWN", reason: "INVALID_BOUNDARY_INPUT" });
    }

    return new Promise((resolve) => {
      let attempted = false;
      let writeCompleted = false;
      let settled = false;
      const finish = (result: EffectBoundaryResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const socket = this.createSocket(endpoint);
      socket.setTimeout(this.timeoutMs);
      socket.once("connect", async () => {
        try {
          const admission = await input.validateExecution();
          if (!admission.ok) {
            finish({ outcome: "NOT_CROSSED", zeroBytesSent: true, errorCode: admission.error.code });
            socket.destroy();
            return;
          }
        } catch {
          finish({ outcome: "NOT_CROSSED", zeroBytesSent: true, errorCode: "PRE_WRITE_VALIDATION_FAILED" });
          socket.destroy();
          return;
        }
        if (settled) return;
        attempted = true;
        socket.write(input.payload, (error?: Error | null) => {
          if (error) {
            finish({ outcome: "UNKNOWN", reason: "WRITE_ERROR" });
            socket.destroy();
            return;
          }
          writeCompleted = true;
          socket.end();
        });
      });
      socket.once("timeout", () => {
        finish({ outcome: "UNKNOWN", reason: "TIMEOUT" });
        socket.destroy();
      });
      socket.once("error", () => {
        finish(attempted
          ? { outcome: "UNKNOWN", reason: "SOCKET_ERROR_AFTER_WRITE_ATTEMPT" }
          : { outcome: "NOT_CROSSED", zeroBytesSent: true, errorCode: "CONNECT_ERROR" });
      });
      socket.once("close", (hadError: boolean) => {
        if (writeCompleted && !hadError) {
          finish({ outcome: "CROSSED", allBytesWritten: true, flushAndFinConfirmed: true });
        } else if (!settled) {
          finish({ outcome: "UNKNOWN", reason: "CLOSE_WITHOUT_COMPLETE_CROSSING" });
        }
      });
    });
  }
}
