import net from "node:net";
import { parseIpv4 } from "../network/ipv4.js";

export type Raw9100ProbeStatus = "SUCCESS" | "TIMEOUT" | "REFUSED" | "ERROR";

export interface Raw9100ProbeResult {
  ip: string;
  port: 9100;
  status: Raw9100ProbeStatus;
  latencyMs: number;
  errorCode: string | null;
  sentBytes: 0;
}

export interface ProbeSocket {
  once(event: "connect", listener: () => void): this;
  once(event: "error", listener: (error: NodeJS.ErrnoException) => void): this;
  destroy(): void;
}

export type ProbeSocketFactory = (options: { host: string; port: 9100 }) => ProbeSocket;

const defaultSocketFactory: ProbeSocketFactory = (options) => net.createConnection(options);

export interface Raw9100ProbeOptions {
  timeoutMs?: number;
  socketFactory?: ProbeSocketFactory;
  now?: () => number;
}

export async function probeRaw9100(ip: string, options: Raw9100ProbeOptions = {}): Promise<Raw9100ProbeResult> {
  parseIpv4(ip);
  const timeoutMs = options.timeoutMs ?? 1_500;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error("INVALID_PROBE_TIMEOUT");
  }

  const now = options.now ?? (() => Date.now());
  const startedAt = now();

  return new Promise((resolve) => {
    let settled = false;
    const socket = (options.socketFactory ?? defaultSocketFactory)({ host: ip, port: 9100 });

    const finish = (status: Raw9100ProbeStatus, errorCode: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({
        ip,
        port: 9100,
        status,
        latencyMs: Math.max(0, now() - startedAt),
        errorCode,
        sentBytes: 0,
      });
    };

    const timer = setTimeout(() => finish("TIMEOUT", "ETIMEDOUT"), timeoutMs);
    socket.once("connect", () => finish("SUCCESS", null));
    socket.once("error", (error) => {
      finish(error.code === "ECONNREFUSED" ? "REFUSED" : "ERROR", error.code ?? "UNKNOWN");
    });
  });
}
