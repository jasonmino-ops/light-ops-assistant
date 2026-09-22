import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { RawTcpEffectBoundary, type TcpSocket } from "../src/main/printing/rawTcpEffectBoundary";

class FakeSocket extends EventEmitter {
  public writeCallback?: (error?: Error | null) => void;
  public written = false;
  public write(_data: Uint8Array, callback?: (error?: Error | null) => void): boolean {
    this.written = true;
    this.writeCallback = callback;
    return true;
  }
  public end(): this { return this; }
  public destroy(): this { return this; }
  public setTimeout(): this { return this; }
}

function setup() {
  const socket = new FakeSocket();
  const boundary = new RawTcpEffectBoundary(1000, () => socket as unknown as TcpSocket);
  const result = boundary.cross({
    endpointKey: "printer.local:9100",
    payload: new Uint8Array([1, 2]),
  });
  return { socket, result };
}

describe("RawTcpEffectBoundary", () => {
  it("proves NOT_CROSSED only for an error before socket.write", async () => {
    const { socket, result } = setup();
    socket.emit("error", new Error("connect"));
    expect(await result).toEqual({ outcome: "NOT_CROSSED", zeroBytesSent: true, errorCode: "CONNECT_ERROR" });
    expect(socket.written).toBe(false);
  });

  it("marks attempted immediately before write and requires write plus clean FIN", async () => {
    const { socket, result } = setup();
    socket.emit("connect");
    expect(socket.written).toBe(true);
    socket.writeCallback?.();
    socket.emit("close", false);
    expect(await result).toEqual({ outcome: "CROSSED", allBytesWritten: true, flushAndFinConfirmed: true });
  });

  it.each(["timeout", "partial-close", "write-error", "post-write-error"])("keeps %s UNKNOWN", async (kind) => {
    const { socket, result } = setup();
    if (kind !== "timeout") socket.emit("connect");
    if (kind === "timeout") socket.emit("timeout");
    if (kind === "partial-close") socket.emit("close", false);
    if (kind === "write-error") socket.writeCallback?.(new Error("partial"));
    if (kind === "post-write-error") socket.emit("error", new Error("reset"));
    expect(await result).toMatchObject({ outcome: "UNKNOWN" });
  });

  it("fails invalid endpoint and empty payload closed without opening a socket", async () => {
    let created = 0;
    const boundary = new RawTcpEffectBoundary(1000, () => { created += 1; return new FakeSocket() as unknown as TcpSocket; });
    expect(await boundary.cross({ endpointKey: "bad", payload: new Uint8Array([1]) })).toMatchObject({ outcome: "UNKNOWN" });
    expect(await boundary.cross({ endpointKey: "host:9100", payload: new Uint8Array() })).toMatchObject({ outcome: "UNKNOWN" });
    expect(created).toBe(0);
  });
});
