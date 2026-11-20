import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { amazonMoney } from "../src/amazonCommon.js";
import { endpoints, resolveEndpoint, validateInput, scrape } from "../src/index.js";
import { toCsv } from "../src/cli.js";
const asin = "B0C3HCD34R";

test("all ten endpoints and public paths resolve", () => {
  assert.equal(endpoints.length, 10);
  for (const endpoint of endpoints) {
    assert.equal(resolveEndpoint(endpoint.name), endpoint.name);
    assert.equal(resolveEndpoint(endpoint.path), endpoint.name);
  }
  assert.equal(resolveEndpoint("product"), "amazon-asin");
  for (const removed of ["reviews", "amazon/reviews", "movers-and-shakers", "amazon/movers-and-shakers"]) {
    assert.throws(() => resolveEndpoint(removed), /Unknown endpoint/);
  }
});
test("standalone input validation rejects unsupported inputs and resolves aliases and seller URLs", () => {
  assert.throws(() => validateInput("search", {}), /required/);
  assert.throws(() => validateInput("search", { query: "test", limit: -1 }), /minimum/);
  assert.throws(() => validateInput("search", { query: "test", unknown: true }), /additional/);
  assert.throws(() => validateInput("product", { asin, url: "https://evil.example/dp/" + asin }), /Unsupported/);
  assert.throws(() => validateInput("search", { query: "one", q: "two" }), /conflicting/);
  const seller = validateInput("seller", { seller_url: "https://www.amazon.co.uk/sp?seller=A294P4X9EWVXLJ" });
  assert.equal(seller.input.marketplace, "amazon.co.uk");
  assert.equal(seller.input.seller_id, "A294P4X9EWVXLJ");
  assert.equal(validateInput("search", { q: "hello", domain: "UK", maxResults: 2 }).input.marketplace, "amazon.co.uk");
});
test("CSV preserves nested data, commas, quotes and newlines", () => {
  const csv = toCsv([{ title: 'A "nice", product\nnext', details: { Brand: "Example" }, price: null }]);
  assert.match(csv, /A ""nice"", product\nnext/);
  assert.match(csv, /""Brand""/);
  assert.equal(toCsv([]), "");
});
test("built CLI lists endpoints and invalid flags exit nonzero before browser startup", async () => {
  const exec = promisify(execFile);
  const { stdout } = await exec(process.execPath, ["dist/cli.js", "--list"]);
  assert.equal(JSON.parse(stdout).length, 10);
  await assert.rejects(exec(process.execPath, ["dist/cli.js", "search", "--query", "test", "--bogus"]));
  await assert.rejects(scrape("search", { query: "test" }, { timeoutMs: 0 }), /positive/);
});

test("displayed currency overrides marketplace defaults", () => {
  assert.deepEqual(amazonMoney("THB494.09", "amazon.co.uk"), { amount: "494.09", currency: "THB" });
  assert.deepEqual(amazonMoney("THB 966.95", "amazon.com"), { amount: "966.95", currency: "THB" });
  assert.deepEqual(amazonMoney("US$29.99", "amazon.ca"), { amount: "29.99", currency: "USD" });
  assert.deepEqual(amazonMoney("฿1,234.56", "amazon.com"), { amount: "1234.56", currency: "THB" });
  assert.deepEqual(amazonMoney("￥1,234", "amazon.co.jp"), { amount: "1234", currency: "JPY" });
});
