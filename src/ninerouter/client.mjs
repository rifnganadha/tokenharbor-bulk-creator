/**
 * 9Router (self-hosted AI gateway) connection client.
 *
 * 9Router is a Next.js dashboard whose provider connections are managed from the
 * authenticated UI, so — exactly like the Token Harbor side — we drive the real
 * pages with Playwright rather than guessing at an undocumented JSON API.
 *
 * Connection flow (mirrors the dashboard by hand):
 *
 *   1. GET  {base}/login                   -> password field + "Login"
 *      fill the dashboard password (default `123456`) and submit
 *      -> redirect to /dashboard
 *   2. GET  {base}/dashboard/providers/tokenharbor -> Token Harbor page
 *      (deep-linked directly; the provider grid is skipped)
 *   3. click "+ Add"                       -> "Add Token Harbor API Key" modal
 *      (a plain fixed overlay, not a role="dialog")
 *   4. fill NAME with the created account email and API KEY with its
 *      `thk_live_…` secret (the "Single" tab; Priority / Proxy Pool keep their
 *      defaults).  The API Key input is rendered as `type="password"`.
 *   5. click "Save"                        -> the key is attached to the gateway
 *
 * Every function is defensive: selectors are matched by accessible role or an
 * anchored text pattern first, then by looser fallbacks, so a small markup tweak
 * in 9Router does not break the whole run.
 *
 * @module ninerouter/client
 */

import { log } from "../utils/logger.mjs";

/** Default dashboard origin for a local 9Router install. */
export const DEFAULT_URL = "http://localhost:20128";

/** Default dashboard password shipped by 9Router (see its login page). */
export const DEFAULT_PASSWORD = "123456";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Body text helper. */
const textOf = (page) => page.evaluate(() => document.body.innerText).catch(() => "");

/**
 * Normalise a 9Router base URL: trim, drop trailing slashes and add an
 * `http://` scheme when the caller passed a bare `host:port`.
 *
 * @param {string} [url]
 * @returns {string}
 */
export function normalizeBaseUrl(url) {
  let s = String(url || DEFAULT_URL).trim();
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  return s.replace(/\/+$/, "");
}

/**
 * Classify a 9Router failure so the caller can decide whether to retry.
 *
 * Selector/UI timeouts are deliberately checked before the generic `timeout`
 * bucket, otherwise a missing button gets misreported as a network problem.
 */
export function classify(err) {
  const m = (err?.message ? err.message : String(err)).toLowerCase();
  if (m.includes("invalid password") || m.includes("incorrect")) return "auth";
  if (m.includes("net::") || m.includes("econnrefused") || m.includes("enotfound")) return "network";
  if (
    m.includes("locator") ||
    m.includes("waiting for") ||
    m.includes("did not") ||
    m.includes("not found") ||
    m.includes("could not") ||
    m.includes("stayed open")
  ) {
    return "ui";
  }
  if (m.includes("timeout")) return "timeout";
  return "other";
}

/**
 * Step 1 — sign in to the 9Router dashboard.
 *
 * If the page already lands on `/dashboard` (a warm session) the form is skipped.
 *
 * @param {import('playwright').Page} page
 * @param {string} password
 * @param {{baseUrl?:string, timeout?:number}} [opts]
 * @returns {Promise<string>} the normalised base URL
 */
export async function login(page, password, opts = {}) {
  const base = normalizeBaseUrl(opts.baseUrl);
  const timeout = opts.timeout ?? 60000;

  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded", timeout });

  // A warm session makes the client-side router bounce `/login` to
  // `/dashboard` a moment *after* load, so an instant URL check races it.
  // Wait until either the password field shows up or the dashboard settles.
  const input = page.locator('input[type="password"]').first();
  const deadline = Date.now() + 20000;
  let mode = "unknown";
  while (Date.now() < deadline && mode === "unknown") {
    if (/\/dashboard/.test(page.url())) mode = "dashboard";
    else if (await input.isVisible().catch(() => false)) mode = "form";
    else await sleep(300);
  }

  if (mode === "dashboard") {
    log.info("9Router: already signed in");
    return base;
  }
  if (mode !== "form") {
    throw new Error("9router: neither the login form nor the dashboard appeared");
  }

  await input.fill(password);

  await Promise.all([
    page.waitForLoadState("domcontentloaded").catch(() => {}),
    page.getByRole("button", { name: /^\s*log\s*in\s*$/i }).first().click({ timeout: 10000 }),
  ]);
  await page.waitForURL(/\/dashboard/, { timeout: 20000 }).catch(() => {});
  await sleep(1500);

  if (!/\/dashboard/.test(page.url())) {
    const text = await textOf(page);
    if (/invalid|incorrect|wrong password/i.test(text)) {
      throw new Error("9router: invalid password");
    }
    throw new Error(`9router: login did not reach the dashboard: ${text.slice(0, 140)}`);
  }
  log.ok("9Router: signed in");
  return base;
}

/**
 * Step 2 — open the Token Harbor provider page.
 *
 * Deep-links straight to the provider route; no need to render the provider
 * grid first.
 *
 * @param {import('playwright').Page} page
 * @param {{baseUrl?:string}} [opts]
 * @returns {Promise<string>} the resulting URL
 */
export async function openTokenHarborPage(page, opts = {}) {
  const base = normalizeBaseUrl(opts.baseUrl);

  await page.goto(`${base}/dashboard/providers/tokenharbor`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await sleep(1500);

  if (!/providers\/tokenharbor/i.test(page.url())) {
    throw new Error(`9router: the Token Harbor provider page did not load: ${page.url()}`);
  }

  log.info("9Router: opened the Token Harbor provider");
  return page.url();
}

/**
 * Steps 3–5 — add one API key through the "Add Token Harbor API Key" dialog.
 *
 * @param {import('playwright').Page} page
 * @param {{name:string, apiKey:string}} account
 */
export async function addApiKey(page, { name, apiKey }) {
  // The "+ Add" button renders a Material Symbols icon whose ligature text
  // ("add") joins the label, so its accessible name is literally "addAdd" —
  // role-based matching fails. Filter on the visible text instead and exclude
  // the neighbouring "Add Model" button.
  const addBtn = page
    .locator("button")
    .filter({ hasText: /add/i })
    .filter({ hasNotText: /model/i })
    .first();
  await addBtn.waitFor({ state: "visible", timeout: 20000 });
  await addBtn.scrollIntoViewIfNeeded().catch(() => {});
  await addBtn.click({ timeout: 15000 });

  // The modal is a plain overlay (no role="dialog"/aria-modal), so anchor on
  // its fixed full-screen wrapper and discriminate by its title text.
  const dialog = page
    .locator("div.fixed.inset-0")
    .filter({ hasText: /add token harbor api key/i })
    .first();
  await dialog.waitFor({ state: "visible", timeout: 20000 });

  // "Single" is the default tab, but select it explicitly in case a previous
  // run left "Bulk Add" active.
  const single = dialog.locator("button").filter({ hasText: /^\s*single\s*$/i }).first();
  if ((await single.count()) > 0) {
    await single.click({ timeout: 3000 }).catch(() => {});
  }

  // Name = the created account's email. It is the only text input in the form
  // (placeholder "Production Key"); API Key is rendered as a password input.
  const nameInput = dialog.locator('input[type="text"], input:not([type])').first();
  await nameInput.waitFor({ state: "visible", timeout: 10000 });
  await nameInput.fill(name);

  const keyInput = dialog.locator('input[type="password"], textarea').first();
  await keyInput.waitFor({ state: "visible", timeout: 10000 });
  await keyInput.fill(apiKey);

  const save = dialog.locator("button").filter({ hasText: /^\s*save\s*$/i }).first();
  await save.click({ timeout: 10000 });

  // Closing the modal is the success signal; a rejected save keeps it open.
  await dialog.waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
  await sleep(1000);
  if (await dialog.isVisible().catch(() => false)) {
    const text = await textOf(page);
    throw new Error(`9router: the Add API Key dialog stayed open after Save: ${text.slice(0, 140)}`);
  }

  log.ok(`9Router: added API key "${name}"`);
  return true;
}

/**
 * Connect one freshly created Token Harbor account to 9Router.
 *
 * Never throws: a failure is reported in the returned record so the caller can
 * keep the (already successful) account result. Retries the whole flow a couple
 * of times because a cold 9Router install can be slow to render.
 *
 * @param {import('playwright').Page} page
 * @param {{email:string, api_key?:string, apiKey?:string}} account
 * @param {{baseUrl?:string, password?:string, retries?:number}} [opts]
 * @returns {Promise<{ok:boolean, url:string, name?:string, error?:string, error_kind?:string, elapsed_ms:number}>}
 */
export async function connectAccount(page, account, opts = {}) {
  const started = Date.now();
  const baseUrl = normalizeBaseUrl(opts.baseUrl);
  const password = opts.password || DEFAULT_PASSWORD;
  const attempts = Math.max(1, opts.retries ?? 2);
  const name = account?.email;
  const apiKey = account?.api_key || account?.apiKey;

  if (!name || !apiKey) {
    return {
      ok: false,
      url: baseUrl,
      error: "missing email or api_key for 9Router connection",
      error_kind: "invalid-account",
      elapsed_ms: 0,
    };
  }

  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      log.step(`[9router try ${i}] connecting ${name}`);
      await login(page, password, { baseUrl });
      await openTokenHarborPage(page, { baseUrl });
      await addApiKey(page, { name, apiKey });
      return { ok: true, url: baseUrl, name, elapsed_ms: Date.now() - started };
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        log.warn(`9router attempt ${i} failed (${classify(err)}); retrying`);
        await sleep(3000);
      }
    }
  }

  log.error(`9Router: could not connect ${name}: ${lastErr.message}`);
  return {
    ok: false,
    url: baseUrl,
    name,
    error: lastErr.message,
    error_kind: classify(lastErr),
    elapsed_ms: Date.now() - started,
  };
}
