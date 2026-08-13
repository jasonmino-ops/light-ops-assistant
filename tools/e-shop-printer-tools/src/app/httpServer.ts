import { randomBytes, timingSafeEqual } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { ReviewLogger } from "./logger.js";
import type { ReviewService } from "./reviewService.js";

export const REVIEW_API_ROUTES = [
  "GET /api/status",
  "POST /api/network/detect",
  "POST /api/front/discover",
  "POST /api/kitchen/discover",
  "POST /api/redetect",
  "POST /api/front/preview",
  "POST /api/kitchen/preview",
  "POST /api/kitchen/probe",
] as const;

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > 16_384) throw new Error("REQUEST_BODY_TOO_LARGE");
    chunks.push(buffer);
  }
  if (total === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON_OBJECT_REQUIRED");
  return parsed as Record<string, unknown>;
}

function selectedIndex(body: Record<string, unknown>): number {
  const index = Number(body.index);
  if (!Number.isInteger(index) || index < 0 || index > 1_000) throw new Error("VALID_SELECTION_INDEX_REQUIRED");
  return index;
}

export function isLocalSessionAuthorized(expected: string, received: string | string[] | undefined): boolean {
  if (typeof received !== "string") return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.byteLength === receivedBytes.byteLength && timingSafeEqual(expectedBytes, receivedBytes);
}

export async function dispatchReviewRoute(
  route: string,
  service: ReviewService,
  body: Record<string, unknown> = {},
): Promise<{ statusCode: number; payload: unknown }> {
  switch (route) {
    case "GET /api/status":
      return { statusCode: 200, payload: service.status() };
    case "POST /api/network/detect":
      return { statusCode: 200, payload: await service.detectNetwork() };
    case "POST /api/front/discover":
      return { statusCode: 200, payload: await service.discoverFront() };
    case "POST /api/kitchen/discover":
      return { statusCode: 200, payload: await service.discoverKitchen() };
    case "POST /api/redetect":
      return { statusCode: 200, payload: await service.redetect() };
    case "POST /api/front/preview":
      return { statusCode: 200, payload: await service.previewFront(selectedIndex(body)) };
    case "POST /api/kitchen/preview":
      return { statusCode: 200, payload: await service.previewKitchen(selectedIndex(body)) };
    case "POST /api/kitchen/probe":
      return { statusCode: 200, payload: await service.probeKitchen(selectedIndex(body)) };
    default:
      return { statusCode: 404, payload: { error: "READ_ONLY_ROUTE_NOT_FOUND" } };
  }
}

export interface ReviewHttpServer {
  readonly sessionToken: string;
  readonly server: http.Server;
  start(): Promise<{ baseUrl: string; port: number }>;
  close(): Promise<void>;
}

export function createReviewHttpServer(
  service: ReviewService,
  logger: ReviewLogger,
  sessionToken = randomBytes(32).toString("hex"),
): ReviewHttpServer {
  const server = http.createServer(async (request, response) => {
    if (!isLocalSessionAuthorized(sessionToken, request.headers["x-eshop-session"])) {
      sendJson(response, 401, { error: "LOCAL_SESSION_REQUIRED" });
      return;
    }

    const route = `${request.method ?? "GET"} ${(request.url ?? "").split("?")[0]}`;
    try {
      const body = request.method === "POST" ? await readJson(request) : {};
      const result = await dispatchReviewRoute(route, service, body);
      sendJson(response, result.statusCode, result.payload);
    } catch (error) {
      logger.error("local_api_error", error, { route });
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  return {
    sessionToken,
    server,
    start: () => new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        const address = server.address() as AddressInfo;
        resolve({ baseUrl: `http://127.0.0.1:${address.port}`, port: address.port });
      });
    }),
    close: () => new Promise((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
