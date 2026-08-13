import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { probeRaw9100, type ProbeSocket, type ProbeSocketFactory } from "../src/index.js";

class FakeSocket extends EventEmitter implements ProbeSocket {
  destroyed = false;
  destroy(): void { this.destroyed = true; }
}

function socketFactory(action: (socket: FakeSocket) => void): { factory: ProbeSocketFactory; socket: FakeSocket } {
  const socket = new FakeSocket();
  return {
    socket,
    factory: () => {
      queueMicrotask(() => action(socket));
      return socket;
    },
  };
}

test("TCP 9100 success closes immediately and sends zero bytes", async () => {
  const fixture = socketFactory((socket) => socket.emit("connect"));
  const result = await probeRaw9100("10.20.30.40", { socketFactory: fixture.factory, timeoutMs: 50 });
  assert.equal(result.status, "SUCCESS");
  assert.equal(result.sentBytes, 0);
  assert.equal(fixture.socket.destroyed, true);
});

test("TCP 9100 reports connection refused", async () => {
  const fixture = socketFactory((socket) => {
    const error = Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
    socket.emit("error", error);
  });
  const result = await probeRaw9100("10.20.30.40", { socketFactory: fixture.factory, timeoutMs: 50 });
  assert.equal(result.status, "REFUSED");
  assert.equal(result.errorCode, "ECONNREFUSED");
  assert.equal(result.sentBytes, 0);
});

test("TCP 9100 reports timeout", async () => {
  const fixture = socketFactory(() => undefined);
  const result = await probeRaw9100("10.20.30.40", { socketFactory: fixture.factory, timeoutMs: 5 });
  assert.equal(result.status, "TIMEOUT");
  assert.equal(result.errorCode, "ETIMEDOUT");
  assert.equal(result.sentBytes, 0);
  assert.equal(fixture.socket.destroyed, true);
});
