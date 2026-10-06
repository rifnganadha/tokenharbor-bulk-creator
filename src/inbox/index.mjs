/**
 * Disposable-inbox readers.
 *
 * Token Harbor sends a click-to-verify email (a link, not a numeric code), so a
 * reader's job is to produce a fresh address and hand back the verification URL
 * found in the newest message.
 *
 * Two backends ship:
 *
 *   - `temp-email-dev` (default): drives the temp-email.dev web UI in a browser.
 *     The site is a Next.js server-action app (`generateTempEmail`,
 *     `getTempEmail`), so the page runtime — not a documented REST API — is the
 *     contract. We open the site, click **New Email** until we have an address,
 *     then expand the newest message and scrape the `tokenharbor.ai/verify-email`
 *     link. The address is generated on demand by the provider, so the caller
 *     cannot choose the local-part; we discover it from the page instead.
 *
 *   - `custom`: any provider exposing the classic temp-mail JSON REST shape
 *     (`GET {base}/domains`, `POST {base}/accounts`, `GET {base}/messages`),
 *     e.g. an instance of mail.tm / mail.gw. Selected with `--inbox-provider custom`
 *     and `--mail-base-url`.
 *
 * Both return the same shape: `{ address, provider }` from `createInbox`, and a
 * URL string from `waitForVerificationLink`.
 *
 * @module inbox
 */

import { log } from "../utils/logger.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Regex for the Token Harbor verification link. */
export const VERIFY_LINK_RE =
  /https?:\/\/tokenharbor\.ai\/verify-email\?token=[A-Za-z0-9._~-]+/i;

/** Sender fragments that identify Token Harbor mail. */
export const SENDER_HINTS = ["tokenharbor", "token harbor", "verify@tokenharbor.ai"];

/** Pull the verification URL out of an arbitrary blob of text/markup. */
export function extractVerificationLink(blob) {
  if (!blob) return null;
  const m = String(blob).match(VERIFY_LINK_RE);
  return m ? m[0] : null;
}

// ---------------------------------------------------------------------------
// temp-email.dev (browser-driven)
// ---------------------------------------------------------------------------

/**
 * Reader that drives the temp-email.dev UI. The inbox page must stay open for
 * the lifetime of the account so polling keeps working.
 *
 * @param {import('playwright').Page} page
 */
export function createTempEmailDevReader(page) {
  const ORIGIN = "https://www.temp-email.dev";

  async function currentAddress() {
    return page
      .evaluate(() => {
        const input = document.querySelector('input[type="text"]');
        const v = input ? input.value : "";
        return /@/.test(v) && v.includes(".") ? v.trim() : null;
      })
      .catch(() => null);
  }

  async function clickNewEmail() {
    const btn = page.getByRole("button", { name: /new email/i }).first();
    if (await btn.count()) {
      await btn.click({ timeout: 10000 }).catch(() => {});
      return true;
    }
    return false;
  }

  return {
    provider: "temp-email.dev",

    /**
     * Open the inbox and return the address the provider generated.
     * @returns {Promise<{address:string, provider:string}>}
     */
    async createInbox() {
      await page.goto(`${ORIGIN}/en`, { waitUntil: "domcontentloaded", timeout: 60000 });

      // The site auto-generates an address on first load; wait for it.
      let address = null;
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        address = await currentAddress();
        if (address) break;
        await sleep(750);
      }

      // If auto-generation stalled, force one explicitly.
      if (!address) {
        await clickNewEmail();
        const retryDeadline = Date.now() + 20000;
        while (Date.now() < retryDeadline) {
          address = await currentAddress();
          if (address) break;
          await sleep(750);
        }
      }
      if (!address) throw new Error("temp-email.dev did not generate an address");
      log.info(`inbox ready: ${address}`);
      return { address, provider: "temp-email.dev" };
    },

    /**
     * Poll the inbox until a Token Harbor verification link appears.
     *
     * @param {string} _address
     * @param {{timeout?:number}} [opts]
     * @returns {Promise<string>} the verification URL
     */
    async waitForVerificationLink(_address, opts = {}) {
      const timeout = opts.timeout ?? 180000;
      const deadline = Date.now() + timeout;
      let expanded = false;
      let lastReload = Date.now();

      // temp-email.dev's own inbox poller can stall silently; nudge it with a
      // reload every 20s so newly delivered mail is actually rendered.
      while (Date.now() < deadline) {
        if (Date.now() - lastReload > 20000) {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
          await sleep(4000);
          expanded = false;
          lastReload = Date.now();
        }

        const body = await page.evaluate(() => document.body.innerText).catch(() => "");

        const hasMail = SENDER_HINTS.some((h) => body.toLowerCase().includes(h));

        if (hasMail && !expanded) {
          // Expand the newest message row (the chevron / row itself).
          await page
            .evaluate(() => {
              const chev = [...document.querySelectorAll("svg")].find((s) =>
                (s.getAttribute("class") || "").includes("chevron"),
              );
              if (chev) (chev.closest("button") || chev).dispatchEvent(
                new MouseEvent("click", { bubbles: true }),
              );
            })
            .catch(() => {});
          await sleep(1500);
          expanded = true;
        }

        const link =
          extractVerificationLink(await page.evaluate(() => document.body.innerText).catch(() => "")) ||
          extractVerificationLink(await page.content().catch(() => ""));
        if (link) return link;

        await sleep(3000);
      }
      throw new Error("timed out waiting for the Token Harbor verification email");
    },

    async close() {
      /* page is owned by the caller */
    },
  };
}

// ---------------------------------------------------------------------------
// Classic temp-mail REST (mail.tm / mail.gw style)
// ---------------------------------------------------------------------------

/**
 * Reader for a classic temp-mail REST backend. No browser needed; uses global
 * `fetch` (Node 18+).
 *
 * @param {{baseUrl:string, domain?:string, fetchImpl?:typeof fetch}} cfg
 */
export function createRestReader(cfg) {
  const base = cfg.baseUrl.replace(/\/$/, "");
  const doFetch = cfg.fetchImpl || fetch;
  let token = null;
  let accountId = null;
  let address = null;

  async function api(path, init = {}) {
    const res = await doFetch(`${base}${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      throw new Error(`mail api ${res.status} ${path}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
    }
    return data;
  }

  return {
    provider: "rest",

    async createInbox() {
      let domain = cfg.domain;
      if (!domain) {
        const domains = await api("/domains");
        const list = Array.isArray(domains) ? domains : domains?.["hydra:member"] || [];
        if (!list.length) throw new Error("mail api returned no domains");
        domain = list[0].domain;
      }
      const local = `${Math.random().toString(36).slice(2, 12)}`;
      address = `${local}@${domain}`;
      const password = Math.random().toString(36).slice(2, 14);

      await api("/accounts", {
        method: "POST",
        body: JSON.stringify({ address, password }),
      });
      const auth = await api("/token", {
        method: "POST",
        body: JSON.stringify({ address, password }),
      });
      token = auth.token || auth.access_token;
      accountId = auth.id;
      log.info(`inbox ready: ${address}`);
      return { address, provider: base };
    },

    async waitForVerificationLink(_address, opts = {}) {
      const timeout = opts.timeout ?? 180000;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const data = await api("/messages");
        const list = Array.isArray(data) ? data : data?.["hydra:member"] || [];
        for (const msg of list) {
          const from = JSON.stringify(msg.from || msg.sender || "").toLowerCase();
          const subject = String(msg.subject || "").toLowerCase();
          const looksRight =
            from.includes("tokenharbor") || subject.includes("verify") || subject.includes("token harbor");
          const body = `${msg.intro || ""} ${msg.text || ""} ${JSON.stringify(msg.html || "")}`;
          const link = extractVerificationLink(body);
          if (link && looksRight) return link;
        }
        await sleep(3000);
      }
      throw new Error("timed out waiting for the Token Harbor verification email");
    },

    async close() {
      if (accountId) await api(`/accounts/${accountId}`, { method: "DELETE" }).catch(() => {});
    },
  };
}

/**
 * Factory used by the orchestrator.
 *
 * @param {string} name  "temp-email-dev" | "custom"
 * @param {import('playwright').Page|null} page
 * @param {object} [opts]
 */
export function createInbox(name, page, opts = {}) {
  if (name === "custom" || name === "rest") {
    if (!opts.mailBaseUrl) throw new Error("--inbox-provider custom requires --mail-base-url");
    return createRestReader({ baseUrl: opts.mailBaseUrl, domain: opts.mailboxDomain });
  }
  if (!page) throw new Error("temp-email.dev reader requires a browser page");
  return createTempEmailDevReader(page);
}
