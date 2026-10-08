/**
 * Core provisioning flow: one Token Harbor account + one API key, end to end.
 *
 * Two browser contexts are used per account — one for the Token Harbor session
 * and one for the disposable inbox — so opening the temporary inbox never
 * disturbs the platform session (separate cookie jars). With the default
 * temp-email.dev provider the inbox context hosts a long-lived page that is
 * polled for the verification link.
 *
 * @module core/provision
 */

import * as tokenharbor from "../tokenharbor/client.mjs";
import { createInbox } from "../inbox/index.mjs";
import { randomEmailLocal, randomKeyName, randomPassword } from "../utils/random.mjs";
import { log } from "../utils/logger.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Classify an error so the caller knows whether a retry can help. */
export function classify(err) {
  const m = (err?.message ? err.message : String(err)).toLowerCase();
  if (m.includes("turnstile")) return "turnstile";
  if (m.includes("already registered") || m.includes("already exists") || m.includes("in use"))
    return "email-taken";
  if (m.includes("timed out waiting for the token harbor verification"))
    return "mail-timeout";
  if (m.includes("too many") || m.includes("rate limit") || m.includes("429")) return "rate-limit";
  if (m.includes("net::") || m.includes("timeout") || m.includes("econnreset")) return "network";
  return "other";
}

/**
 * Which inbox backend is in use determines whether we must generate the email
 * ourselves (REST provider) or let the provider dictate it (temp-email.dev).
 */
function desiredAddress(opts) {
  if (opts.inboxProvider === "custom" || opts.inboxProvider === "rest") {
    return null; // REST readers build the address themselves.
  }
  return null; // temp-email.dev generates the address; we read it back.
}

async function attempt(platformContext, inboxContext, opts, attemptNo) {
  const started = Date.now();
  const keyName = opts.keyName || randomKeyName();
  const password = opts.password || randomPassword(16);

  const platformPage = await platformContext.newPage();
  const inboxPage = await inboxContext.newPage();
  let inbox = null;
  let email = null;

  try {
    log.step(`[try ${attemptNo}] starting account`);

    // 1. Fresh inbox.
    inbox = createInbox(opts.inboxProvider, inboxPage, {
      mailBaseUrl: opts.mailBaseUrl,
      mailboxDomain: opts.mailboxDomain,
      inboxApiKey: opts.inboxApiKey,
    });
    const created = await inbox.createInbox();
    email = created.address;

    // 2. Sign up.
    await tokenharbor.signup(platformPage, email, password, opts);

    // 3. Ask for the verification email.
    await tokenharbor.requestVerificationEmail(platformPage);

    // 4. Read the link from the inbox and follow it.
    log.step(`waiting for the verification email at ${email}`);
    const link = await inbox.waitForVerificationLink(email, { timeout: opts.timeout });
    log.info("verification link received");
    await tokenharbor.openVerificationLink(platformPage, link);

    // 5. Create the API key.
    const apiKey = await tokenharbor.createApiKey(platformPage, keyName);

    return {
      ok: true,
      email,
      password,
      api_key: apiKey,
      key_name: keyName,
      api_base: "https://api.tokenharbor.ai/v1",
      email_provider: created.provider,
      elapsed_ms: Date.now() - started,
      created_at: new Date().toISOString(),
    };
  } catch (err) {
    return {
      ok: false,
      email: email || null,
      password,
      key_name: keyName,
      error: err.message,
      error_kind: classify(err),
      elapsed_ms: Date.now() - started,
      created_at: new Date().toISOString(),
    };
  } finally {
    if (inbox) await inbox.close().catch(() => {});
    await platformPage.close().catch(() => {});
    await inboxPage.close().catch(() => {});
  }
}

// `desiredAddress` is retained for future providers that let us choose a
// local-part; reference it so linters do not flag it as unused.
void desiredAddress;

/**
 * Provision a single account with retries and backoff.
 *
 * @param {import('playwright').BrowserContext} platformContext
 * @param {import('playwright').BrowserContext} inboxContext
 * @param {object} [opts]
 * @returns {Promise<object>} result record
 */
export async function provisionOne(platformContext, inboxContext, opts = {}) {
  const retries = Number.isInteger(opts.retries) ? opts.retries : 3;
  let last;
  for (let i = 1; i <= retries + 1; i++) {
    last = await attempt(platformContext, inboxContext, opts, i);
    if (last.ok) return last;

    if (last.error_kind === "rate-limit") {
      log.warn("rate limit hit — aborting retries for this account");
      return last;
    }
    if (i <= retries) {
      const backoff = Math.min(8000 * i, 30000);
      log.warn(`attempt ${i} failed (${last.error_kind}); retrying in ${backoff}ms`);
      await sleep(backoff);
    }
  }
  return last;
}
