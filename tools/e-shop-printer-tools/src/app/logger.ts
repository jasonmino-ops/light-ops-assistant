import { appendFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ReviewLogger {
  readonly logPath: string;
  info(event: string, details?: Record<string, unknown>): void;
  error(event: string, error: unknown, details?: Record<string, unknown>): void;
}

function defaultLogPath(): string {
  const base = process.env.LOCALAPPDATA || process.env.TEMP || os.tmpdir();
  return path.join(base, "E-Shop Printer Tools", "logs", "e-shop-printer-tools.log");
}

function safeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, code: (error as NodeJS.ErrnoException).code ?? null };
  }
  return { message: String(error) };
}

export class JsonLineReviewLogger implements ReviewLogger {
  readonly logPath: string;

  constructor(logPath = defaultLogPath()) {
    this.logPath = logPath;
    mkdirSync(path.dirname(logPath), { recursive: true });
  }

  private write(level: "INFO" | "ERROR", event: string, details: Record<string, unknown>): void {
    appendFileSync(this.logPath, `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...details,
    })}\n`, { encoding: "utf8", mode: 0o600 });
  }

  info(event: string, details: Record<string, unknown> = {}): void {
    this.write("INFO", event, details);
  }

  error(event: string, error: unknown, details: Record<string, unknown> = {}): void {
    this.write("ERROR", event, { ...details, error: safeError(error) });
  }
}
