import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createReviewHttpServer, REVIEW_API_ROUTES } from "./httpServer.js";
import { JsonLineReviewLogger } from "./logger.js";
import { createDefaultReviewService } from "./reviewService.js";
import {
  BUILD_COMMIT,
  DISABLED_WRITE_OPERATIONS,
  PRODUCT_NAME,
  PRODUCT_VERSION,
  SAFE_MODE,
  WINFORMS_SCRIPT,
  WRITE_OPERATIONS_ENABLED,
  productManifest,
} from "./product.js";

function selfTest(): void {
  const writeLikeRoute = REVIEW_API_ROUTES.find((route) => /save|apply|execute|install|print|queue/i.test(route));
  if (!SAFE_MODE || WRITE_OPERATIONS_ENABLED || writeLikeRoute) {
    throw new Error("SAFE_MODE_INVARIANT_FAILED");
  }
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    manifest: productManifest(),
    apiRoutes: REVIEW_API_ROUTES,
  }, null, 2)}\n`);
}

async function launchWindowsGui(): Promise<void> {
  if (process.platform !== "win32") throw new Error("WINDOWS_ONLY_APPLICATION");
  if (!WINFORMS_SCRIPT) throw new Error("WINFORMS_LAUNCHER_NOT_EMBEDDED");

  const logger = new JsonLineReviewLogger();
  logger.info("startup", {
    productName: PRODUCT_NAME,
    version: PRODUCT_VERSION,
    buildCommit: BUILD_COMMIT,
    safeMode: SAFE_MODE,
    writeOperationsEnabled: WRITE_OPERATIONS_ENABLED,
    disabledWriteOperations: DISABLED_WRITE_OPERATIONS,
    platform: process.platform,
    architecture: process.arch,
  });

  const reviewServer = createReviewHttpServer(createDefaultReviewService(logger), logger);
  const { baseUrl } = await reviewServer.start();
  const launcherPath = path.join(os.tmpdir(), `e-shop-printer-tools-${process.pid}.ps1`);
  writeFileSync(launcherPath, WINFORMS_SCRIPT, { encoding: "utf8", mode: 0o600 });

  const child = spawn("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-WindowStyle", "Hidden",
    "-ExecutionPolicy", "Bypass",
    "-STA",
    "-File", launcherPath,
  ], {
    windowsHide: false,
    stdio: "ignore",
    env: {
      ...process.env,
      E_SHOP_PRINTER_TOOLS_BASE_URL: baseUrl,
      E_SHOP_PRINTER_TOOLS_SESSION: reviewServer.sessionToken,
      E_SHOP_PRINTER_TOOLS_VERSION: PRODUCT_VERSION,
      E_SHOP_PRINTER_TOOLS_COMMIT: BUILD_COMMIT,
      E_SHOP_PRINTER_TOOLS_LOG_PATH: logger.logPath,
    },
  });

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`WINFORMS_EXIT_${code ?? "UNKNOWN"}`)));
  }).finally(async () => {
    try { unlinkSync(launcherPath); } catch { /* best-effort temporary file cleanup */ }
    await reviewServer.close();
  });
}

async function main(): Promise<void> {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }
  await launchWindowsGui();
}

main().catch((error: unknown) => {
  try {
    const logger = new JsonLineReviewLogger();
    logger.error("fatal_error", error);
  } catch { /* no secondary failure path */ }
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
