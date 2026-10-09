/**
 * Token Harbor (tokenharbor.ai) provisioning client.
 *
 * Verified flow (Drive the real UI; Token Harbor is a Next.js app whose auth
 * runs entirely through its own session, not a documented public JSON API):
 *
 *   1. GET  /login?mode=signup          -> "Create your free account" card
 *   2. fill EMAIL + PASSWORD (>=12), click "Create account"
 *      -> POST /api/auth/signup-precheck, then a Supabase-backed session is set
 *      -> redirect to /dashboard (signed in immediately)
 *   3. dashboard offers free models through a first-run modal ("Enable free
 *      models?") and/or an "Enable free models" switch under Data & privacy
 *      -> opt in *before* verifying, so the account lands with free models on
 *   4. dashboard shows "Verify your email to make API calls"
 *      -> click "Verify email" (mails a link to tokenharbor.ai/verify-email?token=…)
 *   5. inbox reader returns that link; navigate to it
 *      -> /dashboard?verify=success   ("Email verified — API access is on")
 *   6. sidebar "API Key" -> "+ New key" -> type a LABEL -> "Create key"
 *      -> the one-time `thk_live_…` secret is shown exactly once
 *
 * There is no Cloudflare Turnstile on Token Harbor as of this writing; the
 * `turnstileTimeout` option is kept for parity with sibling projects and is a
 * no-op when no widget is present.
 *
 * @module tokenharbor/client
 */

import { log } from "../utils/logger.mjs";

export const SITE = "https://tokenharbor.ai";
export const SIGNUP_URL = `${SITE}/login?mode=signup`;
export const DASHBOARD_URL = `${SITE}/dashboard`;
export const API_KEYS_URL = `${SITE}/dashboard/api-keys`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Body text helper. */
const textOf = (page) => page.evaluate(() => document.body.innerText).catch(() => "");

/**
 * Wait for a Cloudflare Turnstile token if the page renders a widget.
 * Returns immediately when there is no widget (the Token Harbor case).
 */
export async function settleTurnstile(page, timeoutMs = 150000) {
  const present = await page
    .evaluate(() => !!document.querySelector('input[name="cf-turnstile-response"]'))
    .catch(() => false);
  if (!present) return;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page
      .evaluate(() => {
        const tok = document.querySelector('input[name="cf-turnstile-response"]');
        const body = document.body.innerText || "";
        return {
          token: tok ? (tok.value || "").length : 0,
          failed: /security check failed/i.test(body),
        };
      })
      .catch(() => null);
    if (!state) return;
    if (state.failed) throw new Error("turnstile: security check failed");
    if (state.token > 0) return;
    await sleep(1500);
  }
  throw new Error("turnstile did not issue a token before the timeout");
}

/**
 * Step 1–2: create the account and land on the dashboard.
 *
 * @param {import('playwright').Page} page
 * @param {string} email
 * @param {string} password
 * @param {{turnstileTimeout?:number}} [opts]
 */
export async function signup(page, email, password, opts = {}) {
  await page.goto(SIGNUP_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Dismiss the optional-cookie banner if present (keeps clicks unobstructed).
  await page
    .getByRole("button", { name: /essential only|accept analytics/i })
    .first()
    .click({ timeout: 4000 })
    .catch(() => {});

  await settleTurnstile(page, opts.turnstileTimeout ?? 150000);

  const emailInput = page.locator('input[type="email"], input[placeholder*="example" i]').first();
  await emailInput.waitFor({ state: "visible", timeout: 30000 });
  await emailInput.fill(email);

  const passInput = page.locator('input[type="password"]').first();
  await passInput.waitFor({ state: "visible", timeout: 15000 });
  await passInput.fill(password);

  await Promise.all([
    page.waitForLoadState("domcontentloaded").catch(() => {}),
    page.getByRole("button", { name: /create account/i }).first().click(),
  ]);
  await sleep(3000);

  let text = await textOf(page);

  // Token Harbor applies a soft anti-abuse throttle; back off and retry once.
  if (/doing that a bit fast|take a breath/i.test(text)) {
    log.warn("signup throttled; backing off and retrying once");
    await sleep(45000);
    // The throttle clears the fields, so refill before resubmitting.
    await emailInput.fill(email).catch(() => {});
    await passInput.fill(password).catch(() => {});
    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => {}),
      page.getByRole("button", { name: /create account/i }).first().click(),
    ]);
    await sleep(4000);
    text = await textOf(page);
    if (/doing that a bit fast|take a breath/i.test(text)) {
      throw new Error("rate-limit: signup throttled by Token Harbor");
    }
  }

  if (/already|exists|in use/i.test(text) && /sign up|create your free account/i.test(text)) {
    throw new Error("email already registered");
  }

  // A successful signup redirects to /dashboard.
  if (!/\/dashboard/.test(page.url())) {
    await page.waitForURL(/\/dashboard/, { timeout: 30000 }).catch(() => {});
  }
  if (!/\/dashboard/.test(page.url())) {
    throw new Error(`signup did not reach the dashboard: ${text.slice(0, 160)}`);
  }
  log.ok("account created, signed in");
}

/**
 * Step 3: opt in to free models on the dashboard.
 *
 * Token Harbor surfaces the free-models opt-in in two places: a first-run
 * modal ("Enable free models?") that otherwise covers the dashboard, and the
 * "Enable free models" switch in the Data & privacy card. Either is enough, so
 * both are handled — the modal is accepted when it appears (instead of being
 * dismissed with "Not now") and the switch is flipped when it does not.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>} true once free models are enabled (best effort)
 */
export async function enableFreeModels(page) {
  await sleep(1500);

  // 1. First-run modal ("Enable free models?"). Accept its affirmative action;
  //    never the dismissive "Not now" / "Skip" options.
  const dialog = page.locator('[role="dialog"], [aria-modal="true"]').first();
  if (await dialog.isVisible().catch(() => false)) {
    const accept = dialog
      .getByRole("button", {
        name: /enable free models|turn on( free models)?|enable|allow|accept|opt in|got it|^yes$|continue/i,
      })
      .first();
    if (await accept.isVisible().catch(() => false)) {
      await accept.click({ timeout: 5000 }).catch(() => {});
      await sleep(1200);
      log.ok("free models enabled");
      return true;
    }
    // A dialog with no affirmative action (e.g. "Not now" only): leave it for
    // the caller to dismiss and fall through to the switch below.
  }

  // 2. The "Enable free models" switch in the Data & privacy card.
  const outcome = await page
    .evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("body *"));
      const label = nodes.find(
        (n) => n.children.length === 0 && /enable free models/i.test(n.textContent || ""),
      );
      if (!label) return "missing";
      // Walk up a few levels to the row that also holds the control.
      let scope = label.parentElement;
      for (let i = 0; i < 5 && scope; i++) {
        const ctl = scope.querySelector(
          '[role="switch"], [role="checkbox"], input[type="checkbox"], button[aria-pressed]',
        );
        if (ctl) {
          const on =
            ctl.getAttribute("aria-checked") === "true" ||
            ctl.getAttribute("aria-pressed") === "true" ||
            (ctl.tagName === "INPUT" && ctl.checked);
          if (on) return "already";
          ctl.click();
          return "enabled";
        }
        scope = scope.parentElement;
      }
      return "missing";
    })
    .catch(() => "error");

  if (outcome === "enabled") {
    await sleep(1000);
    log.ok("free models enabled");
    return true;
  }
  if (outcome === "already") {
    log.info("free models already enabled");
    return true;
  }
  log.warn("free-models toggle not found; continuing");
  return false;
}

/**
 * Step 4: click "Verify email" on the dashboard.
 * Returns true if Token Harbor acknowledged the send.
 *
 * @param {import('playwright').Page} page
 */
export async function requestVerificationEmail(page) {
  // Any residual "Enable free models?" modal is dismissed here; free models
  // are opted into earlier by `enableFreeModels`.
  await page
    .getByRole("button", { name: /^not now$|^skip$|^later$/i })
    .first()
    .click({ timeout: 3000 })
    .catch(() => {});

  const btn = page.getByRole("button", { name: /verify email/i }).first();
  if (await btn.count()) {
    await btn.click({ timeout: 10000 }).catch(() => {});
  } else {
    // Verification may already be done.
    const text = await textOf(page);
    if (/email verified/i.test(text)) return false;
  }
  await sleep(2500);

  const text = await textOf(page);
  if (/email verified/i.test(text)) return false;
  if (/sent — check your inbox|email sent/i.test(text)) {
    log.info("verification email requested");
    return true;
  }
  // Fall through: even if the banner text is unexpected, the mail may be sent.
  log.warn("verification banner not recognised; waiting for the email anyway");
  return true;
}

/**
 * Step 4: open the verification link and confirm the account is verified.
 *
 * @param {import('playwright').Page} page
 * @param {string} link
 */
export async function openVerificationLink(page, link) {
  await Promise.all([
    page.waitForLoadState("domcontentloaded").catch(() => {}),
    page.goto(link, { waitUntil: "domcontentloaded", timeout: 60000 }),
  ]);
  await sleep(3000);
  const text = await textOf(page);
  if (/\/dashboard/.test(page.url()) && /verify=success|email verified/i.test(`${page.url()} ${text}`)) {
    log.ok("email verified");
    return true;
  }
  if (/email verified/i.test(text)) {
    log.ok("email verified");
    return true;
  }
  // Landing on the dashboard at all after the link is a strong success signal.
  if (/\/dashboard/.test(page.url())) {
    log.warn("verification page did not show an explicit success marker; continuing");
    return true;
  }
  throw new Error(`verification link did not verify the account: ${text.slice(0, 160)}`);
}

/**
 * Step 5: create an API key with a random label and return the one-time secret.
 *
 * @param {import('playwright').Page} page
 * @param {string} name
 * @returns {Promise<string>} the `thk_live_…` key
 */
export async function createApiKey(page, name) {
  if (!/api-keys/.test(page.url())) {
    await page.goto(API_KEYS_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  }
  await sleep(1500);

  const before = await textOf(page);
  const existing = before.match(/thk_live_[A-Za-z0-9_-]{20,}/);
  if (existing) {
    log.ok("API key already present");
    return existing[0];
  }

  await page.getByRole("button", { name: /\+\s*new key|new key/i }).first().click({ timeout: 10000 });
  await sleep(800);

  const labelInput = page
    .locator('input[type="text"], input:not([type="hidden"])')
    .first();
  if (await labelInput.count()) await labelInput.fill(name).catch(() => {});

  await Promise.all([
    page.waitForLoadState("domcontentloaded").catch(() => {}),
    page.getByRole("button", { name: /^create key$/i }).first().click(),
  ]);
  await sleep(3000);

  const key = await page.evaluate(() => {
    const m = document.body.innerText.match(/thk_live_[A-Za-z0-9_-]{20,}/);
    return m ? m[0] : null;
  });
  if (!key) throw new Error("API key was not shown after creation (it is revealed only once)");
  log.ok("API key created");
  return key;
}
