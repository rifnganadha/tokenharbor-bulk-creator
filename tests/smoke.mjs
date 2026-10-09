/**
 * Zero-dependency smoke tests for the pure helpers.
 *
 *   node tests/smoke.mjs
 *
 * Exits non-zero on the first failure. These do not touch the network.
 */

import assert from "node:assert/strict";
import { buildOptions, parseProxy } from "../src/utils/config.mjs";
import { randomEmailLocal, randomKeyName, randomPassword } from "../src/utils/random.mjs";
import { extractVerificationLink, createSmtpDevReader, createInbox, VERIFY_LINK_RE } from "../src/inbox/index.mjs";
import { clearSiteData } from "../src/core/provision.mjs";
import { DEFAULT_URL, DEFAULT_PASSWORD, normalizeBaseUrl } from "../src/ninerouter/client.mjs";

const queue = [];
function test(name, fn) {
  queue.push([name, fn]);
}

test("randomEmailLocal is lower-case alphanumeric", () => {
  const v = randomEmailLocal();
  assert.match(v, /^[a-z]+[a-z]+\d{6}$/);
});

test("randomKeyName shape", () => {
  assert.match(randomKeyName(), /^[a-z]+-[a-z]+-\d{4}$/);
});

test("randomPassword length and classes", () => {
  const p = randomPassword(16);
  assert.equal(p.length, 16);
  assert.match(p, /[a-z]/);
  assert.match(p, /[A-Z]/);
  assert.match(p, /\d/);
  assert.match(p, /[!@#$%^&*]/);
});

test("extractVerificationLink finds a token URL", () => {
  const blob = "Click here https://tokenharbor.ai/verify-email?token=abc.DEF-123 to verify";
  assert.equal(
    extractVerificationLink(blob),
    "https://tokenharbor.ai/verify-email?token=abc.DEF-123",
  );
});

test("extractVerificationLink ignores other links", () => {
  assert.equal(extractVerificationLink("https://tokenharbor.ai/dashboard"), null);
  assert.equal(extractVerificationLink(""), null);
});

test("VERIFY_LINK_RE is not global", () => {
  assert.equal(VERIFY_LINK_RE.global, false);
});

test("buildOptions honors CLI over env", () => {
  const o = buildOptions(["node", "x", "-n", "4", "--key-name", "k"], { TH_COUNT: "9" });
  assert.equal(o.count, 4);
  assert.equal(o.keyName, "k");
});

test("parseProxy handles credentials and bare host", () => {
  assert.deepEqual(parseProxy("http://u:p@h:8080"), {
    server: "http://h:8080",
    username: "u",
    password: "p",
  });
  assert.deepEqual(parseProxy("socks5://127.0.0.1:1080"), {
    server: "socks5://127.0.0.1:1080",
  });
  assert.equal(parseProxy(""), null);
});

test("buildOptions rejects unknown flags", () => {
  assert.throws(() => buildOptions(["node", "x", "--nope"]), /unknown option/);
});

// ---------------------------------------------------------------------------
// 9Router options
// ---------------------------------------------------------------------------

test("9Router options fall back to built-in defaults", () => {
  const o = buildOptions(["node", "x"], {
    TH_CONNECT_9ROUTER: "",
    TH_9ROUTER_URL: "",
    TH_9ROUTER_PASSWORD: "",
  });
  assert.equal(o.connectNineRouter, false);
  assert.equal(o.nineRouterUrl, DEFAULT_URL);
  assert.equal(o.nineRouterPassword, DEFAULT_PASSWORD);
});

test("9Router options honor CLI flags", () => {
  const o = buildOptions(
    ["node", "x", "--connect-9router", "--9router-url", "https://r.example.com/", "--9router-password", "pw"],
    {},
  );
  assert.equal(o.connectNineRouter, true);
  assert.equal(o.nineRouterUrl, "https://r.example.com/");
  assert.equal(o.nineRouterPassword, "pw");
});

test("9Router options honor the environment", () => {
  const o = buildOptions(["node", "x"], {
    TH_CONNECT_9ROUTER: "1",
    TH_9ROUTER_URL: "https://env.example.com",
    TH_9ROUTER_PASSWORD: "envpw",
  });
  assert.equal(o.connectNineRouter, true);
  assert.equal(o.nineRouterUrl, "https://env.example.com");
  assert.equal(o.nineRouterPassword, "envpw");
});

test("normalizeBaseUrl adds a scheme and strips trailing slashes", () => {
  assert.equal(normalizeBaseUrl(), DEFAULT_URL);
  assert.equal(normalizeBaseUrl("localhost:20128"), "http://localhost:20128");
  assert.equal(normalizeBaseUrl("https://gateway.example.com///"), "https://gateway.example.com");
});

// ---------------------------------------------------------------------------
// smtp.dev reader (mocked fetch)
// ---------------------------------------------------------------------------

/** Minimal fetch Response stand-in for the reader's `.text()`/`.ok` usage. */
function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (data == null ? "" : JSON.stringify(data)),
  };
}

/** A fetchImpl that serves the smtp.dev routes the reader relies on. */
function smtpDevFetch(seen) {
  return async (url, init = {}) => {
    seen.push({ url, init });
    const { pathname } = new URL(url);
    if (pathname === "/domains") {
      return jsonResponse({
        member: [
          { id: "d-off", domain: "off.test", isActive: false },
          { id: "d-on", domain: "inbox.test", isActive: true },
        ],
      });
    }
    if (pathname === "/accounts" && init.method === "POST") {
      const body = JSON.parse(init.body);
      return jsonResponse(
        { id: "acct-1", address: body.address, mailboxes: [{ id: "mb-1", path: "INBOX" }] },
        201,
      );
    }
    if (pathname === "/accounts/acct-1/mailboxes/mb-1/messages") {
      return jsonResponse({
        member: [
          {
            from: { address: "verify@tokenharbor.ai", name: "Token Harbor" },
            subject: "Verify your email",
            text: "Confirm: https://tokenharbor.ai/verify-email?token=abc.DEF-123",
          },
        ],
      });
    }
    if (pathname === "/accounts/acct-1" && init.method === "DELETE") {
      return jsonResponse(null, 204);
    }
    throw new Error(`unexpected request: ${init.method || "GET"} ${pathname}`);
  };
}

test("smtp.dev reader picks an active domain, creates an inbox, finds the link", async () => {
  const seen = [];
  const reader = createSmtpDevReader({ apiKey: "smtplabs_test", fetchImpl: smtpDevFetch(seen) });

  const box = await reader.createInbox();
  assert.match(box.address, /^[a-z]+\d{6}@inbox\.test$/);
  assert.equal(box.provider, "smtp.dev");

  // Auth header is sent on every request.
  assert.ok(seen.every((c) => c.init.headers["X-API-KEY"] === "smtplabs_test"));

  const link = await reader.waitForVerificationLink(box.address, { timeout: 2000 });
  assert.equal(link, "https://tokenharbor.ai/verify-email?token=abc.DEF-123");

  await reader.close();
  assert.ok(seen.some((c) => c.init.method === "DELETE" && c.url.endsWith("/accounts/acct-1")));
});

test("smtp.dev reader honors a pinned domain", async () => {
  const seen = [];
  const reader = createSmtpDevReader({
    apiKey: "k",
    domain: "pinned.test",
    fetchImpl: smtpDevFetch(seen),
  });
  const box = await reader.createInbox();
  assert.match(box.address, /@pinned\.test$/);
  assert.ok(!seen.some((c) => new URL(c.url).pathname === "/domains"));
});

test("createInbox requires an API key for smtp-dev", () => {
  assert.throws(
    () => createInbox("smtp-dev", null, {}),
    /requires --inbox-api-key/,
  );
});

// ---------------------------------------------------------------------------
// clearSiteData (mocked browser)
// ---------------------------------------------------------------------------

test("clearSiteData clears cookies and origin storage via CDP", async () => {
  const sent = [];
  let evaluated = false;
  let clearedCookies = false;
  const context = {
    newCDPSession: async () => ({
      send: async (method, params) => sent.push([method, params]),
      detach: async () => {},
    }),
    clearCookies: async () => { clearedCookies = true; },
  };
  const page = {
    url: () => "https://tokenharbor.ai/dashboard",
    evaluate: async () => { evaluated = true; },
  };

  await clearSiteData(context, page);

  assert.deepEqual(sent, [
    ["Storage.clearDataForOrigin", { origin: "https://tokenharbor.ai", storageTypes: "all" }],
  ]);
  assert.equal(clearedCookies, true);
  assert.equal(evaluated, false); // CDP handled storage; no in-page fallback
});

test("clearSiteData falls back to in-page clearing without CDP", async () => {
  let evaluated = false;
  let clearedCookies = false;
  const context = {
    newCDPSession: async () => { throw new Error("CDP unavailable"); },
    clearCookies: async () => { clearedCookies = true; },
  };
  const page = {
    url: () => "about:blank",
    evaluate: async () => { evaluated = true; },
  };

  await clearSiteData(context, page);

  assert.equal(evaluated, true);
  assert.equal(clearedCookies, true);
});

// ---------------------------------------------------------------------------

let passed = 0;
for (const [name, fn] of queue) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
}

console.log(`\n${passed} test(s) passed`);
