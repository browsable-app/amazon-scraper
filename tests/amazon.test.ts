import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { amazonBestSellersUrl, amazonProductUrl, extractAmazonCards, extractAmazonProduct } from "../src/getAmazonPublic.js";
import { extractSearchResultsFromPage, getAmazonSearchResults } from "../src/getAmazonSearchResults.js";
import { getPublicApiScraper } from "../src/dispatch.js";

let browser: Browser;
let fixtureContext: import("playwright").BrowserContext;
let page: Page;
before(async () => {
  browser = await chromium.launch({ headless: true });
  fixtureContext = await browser.newContext();
  await fixtureContext.route("**/*", route => route.abort());
  page = await fixtureContext.newPage();
  await page.evaluate("globalThis.__name = fn => fn");
});
after(async () => {
  await browser?.close();
});

const price = `<span class="a-price"><span class="a-offscreen">$44.99</span><span aria-hidden="true">$44.99</span></span>`;
const product = `<input id="ASIN" value="B0C3HCD34R"><div>2-Year Protection Plan $6.99</div><h1 id="productTitle">Headphones</h1>
  <div id="corePrice_feature_div">${price}<span class="a-price a-text-price"><span class="a-offscreen">$69.99</span></span></div>
  <div id="availability"><span>In Stock</span><script>{"private":"state"}</script></div>
  <img id="landingImage" src="https://m.media-amazon.com/images/I/thumbnail.jpg" data-old-hires="https://m.media-amazon.com/images/I/full.jpg">
  <table id="productOverview_feature_div"><tr><td>Brand</td><td>soundcore</td></tr></table>`;

test("product price excludes warranty and list price, extracts images and availability", async () => {
  await page.setContent(product);
  const result = await page.evaluate(extractAmazonProduct);
  assert.equal(result.price, "$44.99");
  assert.equal(result.price_amount, "44.99");
  assert.equal(result.price_currency, "USD");
  assert.equal(result.availability, "InStock");
  assert.equal(result.image_url, "https://m.media-amazon.com/images/I/full.jpg");
  assert.deepEqual(result.details, { Brand: "soundcore" });
});

test("split product prices work when the accessible span is empty", async () => {
  await page.setContent(`<div id="corePriceDisplay_desktop_feature_div"><span class="priceToPay"><span class="a-offscreen"> </span>
    <span class="a-price-symbol">$</span><span class="a-price-whole">1,234<span>.</span></span><span class="a-price-fraction">56</span></span></div>`);
  assert.equal((await page.evaluate(extractAmazonProduct)).price, "$1,234.56");
});

test("unavailable product never substitutes a warranty, recommendation or crossed-out list price", async () => {
  await page.setContent(`<div id="corePrice_feature_div"><span class="a-price a-text-price"><span class="a-offscreen">$69.99</span></span></div>
    <div>2-Year Protection Plan $6.99</div>${price}<div id="outOfStock">Currently unavailable.</div>`);
  const result = await page.evaluate(extractAmazonProduct);
  assert.equal(result.price, null);
  assert.equal(result.price_amount, null);
  assert.equal(result.availability, "OutOfStock");
});

test("best sellers scopes pets and beauty and rejects unsupported categories", () => {
  assert.match(amazonBestSellersUrl("pet supplies"), /\/zgbs\/pet-supplies$/);
  assert.match(amazonBestSellersUrl("Beauty & Personal Care"), /\/zgbs\/beauty$/);
  assert.match(amazonBestSellersUrl("kitchen"), /\/zgbs\/kitchen$/);
  assert.equal(amazonBestSellersUrl(null), "https://www.amazon.com/Best-Sellers/zgbs");
  assert.throws(() => amazonBestSellersUrl("not a department"), /Unsupported/);
});

test("product URL validates host, ASIN and consistency", () => {
  assert.equal(
    amazonProductUrl({ asin: null, url: "https://www.amazon.com/name/dp/B0C3HCD34R?ref=tracking" }),
    "https://www.amazon.com/dp/B0C3HCD34R",
  );
  assert.throws(() => amazonProductUrl({ asin: null, url: "https://amazon.com.evil.com/dp/B0C3HCD34R" }), /Expected|Unsupported/);
  assert.throws(() => amazonProductUrl({ asin: "123", url: null }), /valid/);
  assert.throws(() => amazonProductUrl({ asin: "B085DV8T75", url: "https://www.amazon.com/dp/B0C3HCD34R" }), /different/);
});

test("deals preserve clean titles and sale price without hidden duplicates or list prices", async () => {
  const card = `<div class="dcl-product"><a href="https://www.amazon.com/dp/B0C3HCD34R"><span class="dcl-product-label">Headphones</span>
    <div class="dcl-badge">16% off Limited time deal</div>${price}
    <span class="a-price a-text-price"><span class="a-offscreen">$69.99</span><span>$69.99</span></span></a></div>`;
  await page.setContent(card + card);
  const rows = await page.evaluate(extractAmazonCards, "deals" as const);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.title, "Headphones");
  assert.equal(rows[0]?.price, "$44.99");
  assert.equal(rows[0]?.list_price, "$69.99");
});

test("query deals exclude ordinary search products even when Amazon ignores URL filters", async () => {
  await page.setContent(`<div data-component-type="s-search-result" data-asin="B0C3HCD34R"><a href="https://www.amazon.com/dp/B0C3HCD34R"><h2>Coffee grinder</h2></a>${price}<span class="a-badge-text">Limited time deal</span></div>
    <div data-component-type="s-search-result" data-asin="B085DV8T75"><a href="https://www.amazon.com/dp/B085DV8T75"><h2>Ordinary grinder</h2></a>${price}</div>`);
  const rows = await page.evaluate(extractAmazonCards, "search-deals" as const);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.title, "Coffee grinder");
});

test("search reads canonical ASIN links on the current Amazon domain and the offer price", async () => {
  await page.route("https://www.amazon.fr/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<div data-component-type="s-search-result" data-asin="B0C3HCD34R">
    <a href="/sspa/click?url=tracking"><h2><span>Headphones</span></h2></a><span class="a-color-base">Protection plan $6.99</span>${price}</div>`,
    }),
  );
  await page.goto("https://www.amazon.fr/s?k=headphones");
  const rows = await extractSearchResultsFromPage(page);
  assert.equal(rows[0]?.link, "https://www.amazon.fr/dp/B0C3HCD34R");
  assert.equal(rows[0]?.price, "$44.99");
  await page.unrouteAll();
});

test("search deduplicates sponsored and organic ASINs across pages, then fills the requested limit", async () => {
  const card = (asin: string) =>
    `<div data-component-type="s-search-result" data-asin="${asin}"><a href="/dp/${asin}?tracking=1"><h2><span>${asin}</span></h2></a>${price}</div>`;
  await page.route("https://www.amazon.com/s?**", (route) => {
    const second = new URL(route.request().url()).searchParams.has("page");
    return route.fulfill({
      contentType: "text/html",
      body: second
        ? card("B0C3HCD34R") + card("B085DV8T75")
        : card("B0C3HCD34R") + card("B0C3HCD34R") + `<a class="s-pagination-next" href="/s?k=headphones&page=2">Next</a>`,
    });
  });
  await page.route("https://amazon.com/s?**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body:
        card("B0C3HCD34R") +
        card("B0C3HCD34R") +
        `<a class="s-pagination-next" href="https://www.amazon.com/s?k=headphones&page=2">Next</a>`,
    }),
  );
  const rows = await getAmazonSearchResults(page, "headphones", "amazon.com", 2);
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((row) => row.link)).size, 2);
  await page.unrouteAll();
});

test("public deals queries produce distinct products using active deal badges", async () => {
  const requested: string[] = [];
  await page.route("https://www.amazon.com/s?**", (route) => {
    const query = new URL(route.request().url()).searchParams.get("k")!;
    requested.push(query);
    const asin = query === "coffee grinder" ? "B085DV8T75" : "B0C3HCD34R";
    return route.fulfill({
      contentType: "text/html",
      body: `<div data-component-type="s-search-result" data-asin="${asin}"><a href="https://www.amazon.com/dp/${asin}"><h2>${query}</h2></a>${price}<span class="a-badge-text">Limited time deal</span></div>`,
    });
  });
  const coffee = await getPublicApiScraper(page, "amazon-deals", { query: "coffee grinder", limit: 2 });
  const headphones = await getPublicApiScraper(page, "amazon-deals", { query: "headphones", limit: 2 });
  assert.deepEqual(requested, ["coffee grinder", "headphones"]);
  assert.equal(coffee.count, 1);
  assert.notEqual(coffee.results[0]?.asin, headphones.results[0]?.asin);
  await page.unrouteAll();
});

test("public best sellers request the category department and extract its price", async () => {
  await page.route("https://www.amazon.com/Best-Sellers/zgbs/pet-supplies", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<div class="zg-grid-general-faceout" data-asin="B085DV8T75"><a href="/dp/B085DV8T75"><div class="_cDEzb_p13n-sc-css-line-clamp-3">Cat litter</div></a><span class="_cDEzb_p13n-sc-price">$19.99</span></div>`,
    }),
  );
  const result = await getPublicApiScraper(page, "amazon-best-sellers", { category: "pet supplies" });
  assert.equal(result.results[0]?.title, "Cat litter");
  assert.equal(result.results[0]?.price, "$19.99");
  await page.unrouteAll();
});

test("public dispatcher uses the dedicated Amazon extractor", async () => {
  await page.route("https://www.amazon.com/dp/**", (route) => route.fulfill({ contentType: "text/html", body: product }));
  const result = await getPublicApiScraper(page, "amazon-price", { asin: "B0C3HCD34R" });
  assert.equal(result.count, 1);
  assert.equal(result.data?.price, "$44.99");
  await page.unrouteAll();
});
