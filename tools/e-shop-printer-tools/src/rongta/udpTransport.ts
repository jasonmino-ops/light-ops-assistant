import dgram from "node:dgram";
import type { DiscoveryTarget } from "../types.js";

export interface UdpDiscoveryDatagram {
  data: Uint8Array;
  remoteAddress: string;
  remotePort: number;
  receivedOnInterface: string;
}

export interface UdpDiscoveryRequest {
  requestPayload: Uint8Array;
  targets: DiscoveryTarget[];
  timeoutMs: number;
}

export interface UdpDiscoveryTransport {
  search(request: UdpDiscoveryRequest): Promise<UdpDiscoveryDatagram[]>;
}

function validateRequest(request: UdpDiscoveryRequest): void {
  if (request.requestPayload.byteLength === 0) {
    throw new Error("MISSING_VERIFIED_RONGTA_DISCOVERY_PAYLOAD");
  }
  if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 60_000) {
    throw new Error("INVALID_DISCOVERY_TIMEOUT");
  }
  for (const target of request.targets) {
    if (!Number.isInteger(target.sourcePort) || target.sourcePort < 1 || target.sourcePort > 65_535) {
      throw new Error("INVALID_DISCOVERY_SOURCE_PORT");
    }
    if (!Number.isInteger(target.destinationPort) || target.destinationPort < 1 || target.destinationPort > 65_535) {
      throw new Error("INVALID_DISCOVERY_PORT");
    }
  }
}

async function searchTarget(
  requestPayload: Uint8Array,
  target: DiscoveryTarget,
  timeoutMs: number,
): Promise<UdpDiscoveryDatagram[]> {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const datagrams: UdpDiscoveryDatagram[] = [];
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close(() => error ? reject(error) : resolve(datagrams));
    };

    const timeout = setTimeout(() => finish(), timeoutMs);
    socket.on("error", (error) => finish(error));
    socket.on("message", (message, remote) => {
      datagrams.push({
        data: Uint8Array.from(message),
        remoteAddress: remote.address,
        remotePort: remote.port,
        receivedOnInterface: target.interface,
      });
    });
    socket.bind({ address: target.localAddress, port: target.sourcePort, exclusive: false }, () => {
      try {
        socket.setBroadcast(true);
        socket.send(requestPayload, target.destinationPort, target.broadcastAddress, (error) => {
          if (error) finish(error);
        });
      } catch (error) {
        finish(error as Error);
      }
    });
  });
}

export class NodeUdpDiscoveryTransport implements UdpDiscoveryTransport {
  async search(request: UdpDiscoveryRequest): Promise<UdpDiscoveryDatagram[]> {
    validateRequest(request);
    const results = await Promise.all(request.targets.map((target) => (
      searchTarget(request.requestPayload, target, request.timeoutMs)
    )));
    return results.flat();
  }
}
