/**
 * Minimal library usage example.
 *
 * Runs one provisioning job by importing the modules directly instead of the
 * CLI. Useful when embedding the creator in a larger pipeline.
 *
 *   node examples/provision-one.mjs
 */

import { chromium } from "playwright";
import { provisionOne } from "../src/core/provision.mjs";
import { log } from "../src/utils/logger.mjs";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const platformContext = await browser.newContext({ locale: "en-US" });
  const inboxContext = await browser.newContext({ locale: "en-US" });

  const result = await provisionOne(platformContext, inboxContext, {
    inboxProvider: "temp-email-dev",
    timeout: 180000,
    retries: 2,
  });

  log.raw(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
} finally {
  await browser.close().catch(() => {});
}
