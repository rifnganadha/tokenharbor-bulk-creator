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
import { extractVerificationLink, VERIFY_LINK_RE } from "../src/inbox/index.mjs";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
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

console.log(`\n${passed} test(s) passed`);
