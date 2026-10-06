/**
 * Runtime configuration: CLI flags > environment (.env) > built-in defaults.
 *
 * @module utils/config
 */

import { readFileSync, existsSync } from "node:fs";

/** Parse a minimal KEY=VALUE .env file (no expansion; surrounding quotes stripped). */
export function loadDotenv(path = ".env") {
  const out = {};
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const asInt = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

const asBool = (v) => v === "1" || v === "true" || v === "yes";

/**
 * Build the effective options object.
 * Proxy may come from the CLI or from PROXY_URL / HTTP(S)_PROXY.
 *
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} [env]
 */
export function buildOptions(argv, env = process.env) {
  const dotenv = loadDotenv();
  const cfg = { ...dotenv, ...env };

  const opts = {
    count: asInt(cfg.TH_COUNT, 1),
    concurrency: asInt(cfg.TH_CONCURRENCY, 1),
    out: null,
    inboxProvider: cfg.TH_INBOX_PROVIDER || "temp-email-dev",
    mailBaseUrl: cfg.TH_MAIL_BASE_URL || null,
    mailboxDomain: cfg.TH_MAILBOX_DOMAIN || null,
    password: cfg.TH_PASSWORD || null,
    keyName: cfg.TH_KEY_NAME || null,
    timeout: asInt(cfg.TH_TIMEOUT, 180000),
    turnstileTimeout: asInt(cfg.TH_TURNSTILE_TIMEOUT, 150000),
    retries: asInt(cfg.TH_RETRIES, 3),
    headful: asBool(cfg.TH_HEADFUL),
    quiet: false,
    keepBrowser: asBool(cfg.TH_KEEP_BROWSER),
    proxy: cfg.TH_PROXY || cfg.PROXY_URL || cfg.HTTPS_PROXY || cfg.HTTP_PROXY || null,
    help: false,
    version: false,
    doctor: false,
  };

  const need = (i, name) => {
    if (i + 1 >= argv.length) throw new Error(`${name} requires a value`);
    return argv[i + 1];
  };

  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "-n" || k === "--count") (opts.count = parseInt(need(i, k), 10)), i++;
    else if (k === "-c" || k === "--concurrency") (opts.concurrency = parseInt(need(i, k), 10)), i++;
    else if (k === "-o" || k === "--out") (opts.out = need(i, k)), i++;
    else if (k === "-t" || k === "--timeout") (opts.timeout = parseInt(need(i, k), 10)), i++;
    else if (k === "--turnstile-timeout") (opts.turnstileTimeout = parseInt(need(i, k), 10)), i++;
    else if (k === "--retries") (opts.retries = parseInt(need(i, k), 10)), i++;
    else if (k === "--inbox-provider") (opts.inboxProvider = need(i, k)), i++;
    else if (k === "--mail-base-url") (opts.mailBaseUrl = need(i, k)), i++;
    else if (k === "--mailbox-domain") (opts.mailboxDomain = need(i, k)), i++;
    else if (k === "--password") (opts.password = need(i, k)), i++;
    else if (k === "--key-name") (opts.keyName = need(i, k)), i++;
    else if (k === "--proxy") (opts.proxy = need(i, k)), i++;
    else if (k === "--headful") opts.headful = true;
    else if (k === "--keep-browser") opts.keepBrowser = true;
    else if (k === "-q" || k === "--quiet") opts.quiet = true;
    else if (k === "--doctor") opts.doctor = true;
    else if (k === "-v" || k === "--version") opts.version = true;
    else if (k === "-h" || k === "--help") opts.help = true;
    else throw new Error(`unknown option: ${k} (try --help)`);
  }

  if (opts.count < 1) opts.count = 1;
  if (opts.concurrency < 1) opts.concurrency = 1;
  if (opts.retries < 0) opts.retries = 0;
  return opts;
}

/**
 * Parse a proxy string into Playwright's `{ server, username?, password? }`.
 * Accepts http(s)://user:pass@host:port, socks5://host:port, and bare host:port.
 */
export function parseProxy(str) {
  if (!str) return null;
  let s = str.trim();
  if (!/^[a-z0-9+.-]+:\/\//i.test(s)) s = `http://${s}`;
  const u = new URL(s);
  const out = { server: `${u.protocol}//${u.host}` };
  if (u.username) out.username = decodeURIComponent(u.username);
  if (u.password) out.password = decodeURIComponent(u.password);
  return out;
}
