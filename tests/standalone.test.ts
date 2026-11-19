import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium, type Browser } from "playwright";
import { amazonMoney } from "../src/amazonCommon.js";
import { endpoints, resolveEndpoint, validateInput, scrapeWithPage, scrape } from "../src/index.js";
import { toCsv } from "../src/cli.js";
let browser: Browser;
let fixtureContext: import("playwright").BrowserContext;
before(async () => { browser = await chromium.launch(); fixtureContext = await browser.newContext(); await fixtureContext.route("**/*", route => route.abort()); });
after(async () => { await browser?.close(); });
const asin = "B0C3HCD34R";
const review = (id: string, username = "Reader") => `<div data-hook="review" id="${id}"><div data-hook="genome-widget"><span class="a-profile-name">${username}</span></div><a data-hook="review-title"><span>Good product</span></a><i data-hook="review-star-rating"><span class="a-icon-alt">4.5 out of 5 stars</span></i><span data-hook="review-date">Reviewed in the United States on November 1, 2026</span><span data-hook="review-body"><span>Works well.</span></span><span data-hook="avp-badge">Verified Purchase</span></div>`;

test("all twelve endpoints and public paths resolve", () => {
  assert.equal(endpoints.length, 12);
  for (const endpoint of endpoints) {
    assert.equal(resolveEndpoint(endpoint.name), endpoint.name);
    assert.equal(resolveEndpoint(endpoint.path), endpoint.name);
  }
  assert.equal(resolveEndpoint("product"), "amazon-asin");
  assert.throws(() => resolveEndpoint("unrelated"), /Unknown endpoint/);
});
test("standalone input validation rejects unsupported inputs and resolves aliases and seller URLs", () => {
  assert.throws(() => validateInput("search", {}), /required/);
  assert.throws(() => validateInput("search", { query: "test", limit: -1 }), /minimum/);
  assert.throws(() => validateInput("search", { query: "test", unknown: true }), /additional/);
  assert.throws(() => validateInput("reviews", { asin, url: "https://evil.example/dp/" + asin }), /Unsupported/);
  assert.throws(() => validateInput("search", { query: "one", q: "two" }), /conflicting/);
  const seller = validateInput("seller", { seller_url: "https://www.amazon.co.uk/sp?seller=A294P4X9EWVXLJ" });
  assert.equal(seller.input.marketplace, "amazon.co.uk");
  assert.equal(seller.input.seller_id, "A294P4X9EWVXLJ");
  assert.equal(validateInput("search", { q: "hello", domain: "UK", maxResults: 2 }).input.marketplace, "amazon.co.uk");
});
test("reviews preserve unused listing rows across cursor continuation", async () => {
  const page = await fixtureContext.newPage();
  try {
    await page.route("https://www.amazon.com/**", route => route.fulfill({ contentType: "text/html", body: review("R1") + review("R2", "Other") }));
    const first = await scrapeWithPage(page, "reviews", { asin, limit: 1 });
    assert.equal(first.results[0].id, "R1");
    assert.equal(first.data?.coverage, "review_listing");
    const next = await scrapeWithPage(page, "reviews", { asin, limit: 1, cursor: first.pagination.next_cursor });
    assert.equal(next.results[0].id, "R2");
    assert.equal(next.pagination.next_cursor, null);
    await assert.rejects(scrapeWithPage(page, "reviews", { asin: "B085DV8T75", cursor: first.pagination.next_cursor }), /Invalid Amazon cursor/);
  } finally { await page.close(); }
});
test("reviews fall back from sign-in to direct featured reviews and identify reduced coverage", async () => {
  const page = await fixtureContext.newPage();
  const requested: string[] = [];
  try {
    await page.route("**/*", route => {
      requested.push(route.request().url());
      if (route.request().url().includes("/product-reviews/")) return route.fulfill({ contentType: "text/html", body: '<script>history.replaceState({}, "", "/ap/signin")</script>Sign in' });
      if (route.request().url().includes("/ap/signin")) return route.fulfill({ contentType: "text/html", body: "Sign in" });
      return route.fulfill({ contentType: "text/html", body: `<h1 id="productTitle">Headphones</h1>${review("R1")}` });
    });
    const result = await scrapeWithPage(page, "reviews", { asin, limit: 2 });
    assert.equal(result.count, 1);
    assert.equal(result.data?.coverage, "featured_reviews");
    assert.match(String(result.data?.notice), /not the full/);
    assert.equal(result.pagination.strategy, "none");
    assert.ok(requested.every(url => ["www.amazon.com", "amazon.com"].includes(new URL(url).hostname)), JSON.stringify(requested));
  } finally { await page.close(); }
});
test("review access blocks fail explicitly", async () => {
  const page = await fixtureContext.newPage();
  try {
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<title>Robot Check</title><input id="captchacharacters">' }));
    await assert.rejects(scrapeWithPage(page, "reviews", { asin }), /blocked/);
  } finally { await page.close(); }
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
  assert.equal(JSON.parse(stdout).length, 12);
  await assert.rejects(exec(process.execPath, ["dist/cli.js", "search", "--query", "test", "--bogus"]));
  await assert.rejects(scrape("search", { query: "test" }, { timeoutMs: 0 }), /positive/);
});

test("displayed currency overrides marketplace defaults", () => {
  assert.deepEqual(amazonMoney("THB 966.95", "amazon.com"), { amount: "966.95", currency: "THB" });
  assert.deepEqual(amazonMoney("US$29.99", "amazon.ca"), { amount: "29.99", currency: "USD" });
  assert.deepEqual(amazonMoney("฿1,234.56", "amazon.com"), { amount: "1234.56", currency: "THB" });
  assert.deepEqual(amazonMoney("￥1,234", "amazon.co.jp"), { amount: "1234", currency: "JPY" });
});

test("sign-in-only featured review sections return authentication_required", async () => {
  const page = await fixtureContext.newPage();
  try {
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: route.request().url().includes("/product-reviews/") ? '<script>history.replaceState({}, "", "/ap/signin")</script>Sign in' : '<h1 id="productTitle">Headphones</h1>Sign in to see customer reviews.' }));
    await assert.rejects(scrapeWithPage(page, "reviews", { asin }), (error: any) => error.error_code === "authentication_required");
  } finally { await page.close(); }
});
