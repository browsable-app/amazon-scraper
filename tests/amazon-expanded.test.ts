import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { getPublicApiScraper } from "../src/dispatch.js";
import { navigateAmazon, amazonSearchUrl, type AmazonSource } from "../src/getAmazonPublic.js";
import { amazonMarketplace, amazonMoney, isRetryableAmazonPublicError } from "../src/amazonCommon.js";
import { amazonTaskDefinitions } from "../src/amazonTaskDefinitions.js";
import { validateJsonSchemaValue } from "../src/validation.js";
let browser: Browser;
let fixtureContext: import("playwright").BrowserContext;
before(async () => {
  browser = await chromium.launch({ headless: true });
  fixtureContext = await browser.newContext();
  await fixtureContext.route("**/*", route => route.abort());
});
after(async () => {
  await browser?.close();
});
const asins = ["B0C3HCD34R", "B085DV8T75", "B000123456"];
const htmlPrice = (price: string) =>
  `<span class="a-price"><span class="a-offscreen">${price}</span><span aria-hidden="true">${price}</span></span>`;
function product(asin: string, price = "$44.99") {
  return `<div id="glow-ingress-block">Deliver to New York 10001</div><input id="ASIN" value="${asin}"><h1 id="productTitle">Product ${asin}</h1><div id="corePrice_feature_div">${htmlPrice(price)}</div><div id="availability"><span>In Stock</span></div><img id="landingImage" src="https://m.media-amazon.com/images/I/test.jpg">`;
}
function card(asin: string, price = "$44.99", rating = "4.5") {
  return `<div data-component-type="s-search-result" data-asin="${asin}"><a href="/dp/${asin}"><h2>Product ${asin}</h2></a>${htmlPrice(price)}<span class="a-icon-alt">${rating} out of 5 stars</span><div data-cy="reviews-block"><span class="s-underline-text">79.3K</span></div><span class="a-badge-text">Limited time deal</span></div>`;
}
async function withPage(fn: (page: Page) => Promise<void>) {
  const page = await fixtureContext.newPage();
  try {
    await fn(page);
  } finally {
    await page.close();
  }
}
function schema(source: AmazonSource, out: unknown) {
  const def = amazonTaskDefinitions.find((d) => d.builtin === source)!;
  const result = validateJsonSchemaValue(def.outputSchema, out);
  assert.ok(result.valid, JSON.stringify(result.errors));
}

test("all 11 Amazon contracts have unique paths, canonical inputs and complete result schemas", () => {
  assert.equal(amazonTaskDefinitions.length, 11);
  assert.equal(new Set(amazonTaskDefinitions.map((d) => d.path)).size, 11);
  for (const def of amazonTaskDefinitions) {
    assert.equal(def.inputSchema.additionalProperties, false);
    assert.ok(def.inputSchema.properties.marketplace);
    assert.ok(def.outputSchema.properties.results.items);
  }
  for (const name of ["amazon-product-offers", "amazon-product-variations", "amazon-asin", "amazon-price"]) {
    const def = amazonTaskDefinitions.find((d) => d.builtin === name)!;
    assert.equal(validateJsonSchemaValue(def.inputSchema, {}).valid, false);
    assert.equal(validateJsonSchemaValue(def.inputSchema, { asin: asins[0], marketplace: "amazon.co.uk" }).valid, true);
  }
  assert.equal(
    validateJsonSchemaValue(amazonTaskDefinitions.find((d) => d.builtin === "amazon-product-variations")!.inputSchema, {
      asin: asins[0],
      include_details: true,
      limit: 11,
    }).valid,
    false,
  );
});

test("marketplaces are allowlisted and localized money is normalized", () => {
  assert.equal(amazonMarketplace("UK"), "amazon.co.uk");
  assert.throws(() => amazonMarketplace("amazon.com.evil.test"), /Unsupported/);
  assert.throws(() => amazonMarketplace("amazon.com", "https://www.amazon.de/dp/B0C3HCD34R"), /match/);
  assert.throws(() => amazonMarketplace(null, "https://www.amazon.com:8443/dp/B0C3HCD34R"), /HTTPS/);
  assert.deepEqual(amazonMoney("1.234,56 €", "amazon.de"), { amount: "1234.56", currency: "EUR" });
  assert.deepEqual(amazonMoney("£1,234.56", "amazon.co.uk"), { amount: "1234.56", currency: "GBP" });
  assert.deepEqual(amazonMoney("€26.99", "amazon.de"), { amount: "26.99", currency: "EUR" });
  assert.deepEqual(amazonMoney("￥1,234", "amazon.co.jp"), { amount: "1234", currency: "JPY" });
});

test("search URL encodes filters and rejects invalid price ranges and seller IDs", () => {
  const url = new URL(
    amazonSearchUrl(
      {
        query: "wireless headphones",
        brand: "Soundcore",
        category_id: "172541",
        min_price: 20,
        max_price: 100,
        min_rating: 4,
        sort: "price_asc",
      },
      "amazon.com",
      2,
    ),
  );
  assert.equal(url.searchParams.get("low-price"), "20");
  assert.equal(url.searchParams.get("s"), "price-asc-rank");
  assert.equal(url.searchParams.get("page"), "2");
  assert.match(url.searchParams.get("rh")!, /p_89:Soundcore/);
  assert.throws(() => amazonSearchUrl({ min_price: 40, max_price: 20 }, "amazon.com"), /must not exceed/);
  assert.throws(() => amazonSearchUrl({ seller_id: "id&me=other" }, "amazon.com"), /merchant ID/);
});

test("search cursors retain every item after upstream reordering and bind filters", async () =>
  withPage(async (page) => {
    let calls = 0;
    await page.route("https://www.amazon.com/s?**", (route) =>
      route.fulfill({ contentType: "text/html", body: (++calls === 1 ? asins : [...asins].reverse()).map((a) => card(a)).join("") }),
    );
    const first = await getPublicApiScraper(page, "amazon-search", { query: "headphones", limit: 1 });
    schema("amazon-search", first);
    assert.equal(first.results[0]?.numberOfReviews, 79300);
    const next = await getPublicApiScraper(page, "amazon-search", { query: "headphones", limit: 2, cursor: first.pagination.next_cursor });
    assert.equal(new Set([...first.results, ...next.results].map((r) => r.asin)).size, 3);
    assert.equal(next.pagination.next_cursor, null);
    await assert.rejects(
      getPublicApiScraper(page, "amazon-search", { query: "different", cursor: first.pagination.next_cursor }),
      /cursor/,
    );
  }));

test("public search enforces numeric filters and retains legacy result fields", async () =>
  withPage(async (page) => {
    await page.route("https://www.amazon.com/s?**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: card(asins[0]!, "$44.99", "4.5") + card(asins[1]!, "$9.99", "4.8") + card(asins[2]!, "$54.99", "3.2"),
      }),
    );
    const out = await getPublicApiScraper(page, "amazon-search", {
      query: "headphones",
      min_price: 20,
      max_price: 50,
      min_rating: 4,
      limit: 5,
    });
    assert.equal(out.count, 1);
    assert.equal(out.results[0]?.name, `Product ${asins[0]}`);
    assert.ok(out.results[0]?.link);
    schema("amazon-search", out);
  }));

test("seller catalogue requests stay scoped to the merchant and paginate", async () =>
  withPage(async (page) => {
    await page.route("https://www.amazon.com/s?**", (route) => {
      assert.equal(new URL(route.request().url()).searchParams.get("me"), "A294P4X9EWVXLJ");
      return route.fulfill({ contentType: "text/html", body: asins.map((a) => card(a)).join("") });
    });
    const out = await getPublicApiScraper(page, "amazon-seller-products", { seller_id: "A294P4X9EWVXLJ", limit: 1 });
    assert.ok(out.pagination.next_cursor);
    schema("amazon-seller-products", out);
  }));

const variants = `<script>P.register('twister-js-init-dpx-data', function(){var x={"parentAsin":"B000PARENT1","dimensions":["color_name","size_name"],"dimensionValuesDisplayData":{"B0C3HCD34R":["Black","Standard"],"B085DV8T75":["White","Large"]}};return x;});</script>`;
test("variations return distinct child ASIN attributes and fetch their own prices on request", async () =>
  withPage(async (page) => {
    await page.route("https://www.amazon.com/dp/**", (route) => {
      const asin = new URL(route.request().url()).pathname.split("/").at(-1)!;
      return route.fulfill({ contentType: "text/html", body: product(asin, asin === asins[0] ? "$44.99" : "$24.00") + variants });
    });
    const out = await getPublicApiScraper(page, "amazon-product-variations", { asin: asins[0], limit: 2, include_details: true });
    assert.equal(out.data?.parent_asin, "B000PARENT1");
    assert.deepEqual(out.results[1]?.attributes, { color_name: "White", size_name: "Large" });
    assert.deepEqual(
      out.results.map((r) => r.price_amount),
      ["44.99", "24.00"],
    );
    schema("amazon-product-variations", out);
  }));

test("batch deduplicates case-insensitive ASINs and reports individual failures", async () =>
  withPage(async (page) => {
    const visited: string[] = [];
    await page.route("https://www.amazon.com/dp/**", (route) => {
      const asin = new URL(route.request().url()).pathname.split("/").at(-1)!;
      visited.push(asin);
      return route.fulfill({ status: asin === asins[1] ? 404 : 200, contentType: "text/html", body: product(asin) });
    });
    const out = await getPublicApiScraper(page, "amazon-products-batch", { asins: [asins[0], asins[0]!.toLowerCase(), asins[1]] });
    assert.equal(visited.length, 2);
    assert.equal(out.data?.requested, 2);
    assert.equal(out.data?.failed, 1);
    schema("amazon-products-batch", out);
    await assert.rejects(getPublicApiScraper(page, "amazon-products-batch", { asins: [asins[1]] }), /failed for all/);
  }));

function offer(id: string, featured = false, shipping = "FREE", text = "FREE delivery Thursday") {
  return `<div id="${featured ? "aod-pinned-offer" : "aod-offer"}"><div id="aod-offer-heading">New</div><div id="aod-offer-price">${htmlPrice("$44.99")}</div><div id="aod-offer-soldBy"><div class="a-col-right"><a href="/sp?seller=${id}">Seller ${id}</a></div></div><div id="aod-delivery-promise" data-csa-c-delivery-price="${shipping}">${text}</div></div>`;
}
test("offers retain Featured Offer status, deduplicate repeats and avoid guessing conditional shipping", async () =>
  withPage(async (page) => {
    await page.route("https://www.amazon.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: route.request().url().includes("aodAjaxMain")
          ? `<input id="aod-total-offer-count" value="2">` +
            offer("SELLERAAA", true) +
            offer("SELLERAAA") +
            offer("SELLERBBB", false, "FREE", "FREE delivery on orders over $35")
          : product(asins[0]!),
      }),
    );
    const out = await getPublicApiScraper(page, "amazon-product-offers", { asin: asins[0], limit: 5 });
    assert.equal(out.count, 2);
    assert.equal(out.results[0]?.is_featured_offer, true);
    assert.equal(out.results[0]?.total_amount, "44.99");
    assert.equal(out.results[1]?.shipping_amount, null);
    assert.equal(out.results[1]?.total_amount, null);
    schema("amazon-product-offers", out);
  }));

test("new releases use their own list and Movers and Shakers preserves an explicit upstream empty state", async () =>
  withPage(async (page) => {
    await page.route("https://www.amazon.com/gp/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: route.request().url().includes("movers-and-shakers")
          ? "<h1>Movers & Shakers</h1>Sorry, there are no movers and shakers available in this category."
          : `<div class="zg-grid-general-faceout" data-asin="${asins[0]}"><a href="/dp/${asins[0]}"><div class="p13n-sc-css-line-clamp">New gadget</div></a>${htmlPrice("$44.99")}</div>`,
      }),
    );
    const news = await getPublicApiScraper(page, "amazon-new-releases", { category: "electronics", limit: 1 });
    assert.equal(news.count, 1);
    schema("amazon-new-releases", news);
    const movers = await getPublicApiScraper(page, "amazon-movers-and-shakers", { category: "electronics" });
    assert.equal(movers.count, 0);
    assert.match(String(movers.data?.notice), /no entries/);
    schema("amazon-movers-and-shakers", movers);
  }));

test("marketplace search returns local links and correct currency with comma decimals", async () =>
  withPage(async (page) => {
    await page.route("https://www.amazon.de/s?**", (route) =>
      route.fulfill({ contentType: "text/html", body: card(asins[0]!, "1.234,56 €", "4,5") }),
    );
    const out = await getPublicApiScraper(page, "amazon-search", { query: "kopfhörer", marketplace: "amazon.de", limit: 1 });
    assert.equal(out.results[0]?.price_amount, "1234.56");
    assert.equal(out.results[0]?.price_currency, "EUR");
    assert.equal(out.results[0]?.rating, 4.5);
    assert.match(String(out.results[0]?.url), /www.amazon.de/);
    schema("amazon-search", out);
  }));

test("delivery postal codes require a successful Amazon update and are included in the result", async () =>
  withPage(async (page) => {
    let applied = false;
    await page.route("https://www.amazon.com/**", (route) => {
      if (route.request().url().includes("address-change")) {
        applied = true;
        return route.fulfill({ contentType: "application/json", body: '{"isValidAddress":true}' });
      }
      return route.fulfill({
        contentType: "text/html",
        body:
          product(asins[0]!).replace("10001", applied ? "90210" : "10001") +
          `<a id="nav-global-location-popover-link" href="#">Location</a><input id="GLUXZipUpdateInput"><button id="GLUXZipUpdate" onclick="fetch('/portal-migration/hz/glow/address-change',{method:'POST'})">Apply</button>`,
      });
    });
    const out = await getPublicApiScraper(page, "amazon-price", { asin: asins[0], postal_code: "90210" });
    assert.equal(applied, true);
    assert.deepEqual(out.data?.delivery_location, { postal_code: "90210", applied: true, displayed: "Deliver to New York 90210" });
    schema("amazon-price", out);
  }));

test("temporary Amazon server errors retry once without returning an empty success", async () =>
  withPage(async (page) => {
    let calls = 0;
    await page.route("https://www.amazon.com/s?**", (route) =>
      route.fulfill(
        ++calls === 1
          ? { status: 503, contentType: "text/html", body: "Temporarily unavailable" }
          : { contentType: "text/html", body: card(asins[0]!) },
      ),
    );
    const out = await getPublicApiScraper(page, "amazon-search", { query: "headphones", limit: 1 });
    assert.equal(calls, 2);
    assert.equal(out.count, 1);
  }));

test("Amazon challenge pages fail explicitly without fabricating product data", async () =>
  withPage(async (page) => {
    let calls = 0;
    await page.route("https://www.amazon.com/s?**", (route) => {
      calls++;
      return route.fulfill({ contentType: "text/html", body: '<title>Robot Check</title><input id="captchacharacters">' });
    });
    await assert.rejects(getPublicApiScraper(page, "amazon-search", { query: "headphones" }), /request blocked/);
    assert.equal(calls, 1);
  }));

test("variations also support indexed ASIN attribute maps", async () =>
  withPage(async (page) => {
    const indexed =
      '<script>var data={"parentAsin":"B000PARENT1","dimensions":["color_name"],"variationValues":{"color_name":["Black","White"]},"asinVariationValues":{"B0C3HCD34R":{"color_name":0},"B085DV8T75":{"color_name":1}}};</script>';
    await page.route("https://www.amazon.com/dp/**", (route) =>
      route.fulfill({ contentType: "text/html", body: product(asins[0]!) + indexed }),
    );
    const out = await getPublicApiScraper(page, "amazon-product-variations", { asin: asins[0], limit: 2 });
    assert.equal(out.count, 2);
    assert.deepEqual(out.results[1]?.attributes, { color_name: "White" });
    schema("amazon-product-variations", out);
  }));

test("large search requests continue beyond three small upstream pages", async () =>
  withPage(async (page) => {
    const visited: number[] = [];
    await page.route("https://www.amazon.com/s?**", (route) => {
      const number = Number(new URL(route.request().url()).searchParams.get("page") || 1);
      visited.push(number);
      const body =
        Array.from({ length: 16 }, (_, index) => card(`B${String((number - 1) * 16 + index).padStart(9, "0")}`)).join("") +
        `<a class="s-pagination-next" href="/s?k=headphones&page=${number + 1}">Next</a>`;
      return route.fulfill({ contentType: "text/html", body });
    });
    const out = await getPublicApiScraper(page, "amazon-search", { query: "headphones", limit: 100 });
    assert.equal(out.count, 100);
    assert.equal(new Set(out.results.map((row) => row.asin)).size, 100);
    assert.equal(visited.length, 7);
    assert.ok(out.pagination.next_cursor);
  }));

test("Italian HTTP-200 temporary error pages retry and recover", async () =>
  withPage(async (page) => {
    let calls = 0;
    await page.route("https://www.amazon.it/s/**", (route) =>
      route.fulfill(
        ++calls === 1
          ? { contentType: "text/html", body: "<title>Ci dispiace</title><h1>Ci dispiace</h1>Si è verificato un errore" }
          : { contentType: "text/html", body: card(asins[0]!) },
      ),
    );
    const out = await getPublicApiScraper(page, "amazon-search", { query: "cuffie", marketplace: "amazon.it", limit: 1 });
    assert.equal(calls, 2);
    assert.equal(out.count, 1);
  }));

test("persistent localized soft errors are retryable, never empty successes", async () =>
  withPage(async (page) => {
    await page.route("https://www.amazon.it/s/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<title>Ci dispiace</title>Si è verificato un errore" }),
    );
    await assert.rejects(getPublicApiScraper(page, "amazon-search", { query: "cuffie", marketplace: "amazon.it", limit: 1 }), {
      name: "AmazonTemporaryError",
    });
  }));

test("automated-access interstitials stop without creating empty results or retrying", async () =>
  withPage(async (page) => {
    let calls = 0;
    await page.route("https://www.amazon.ca/s/**", (route) => {
      calls++;
      return route.fulfill({
        status: 503,
        contentType: "text/html",
        body: '<title>amazon.ca</title>Continued access by an unauthorized AI agent violates Amazon’s Conditions of Use.<a href="/">Continue</a>',
      });
    });
    await assert.rejects(
      getPublicApiScraper(page, "amazon-search", { query: "headphones", marketplace: "amazon.ca", limit: 1 }),
      /request blocked/,
    );
    assert.equal(calls, 1);
  }));

test("temporary-error words in product content do not hide valid results", async () =>
  withPage(async (page) => {
    let calls = 0;
    await page.route("https://www.amazon.it/s/**", (route) => {
      calls++;
      return route.fulfill({ contentType: "text/html", body: "<title>Ci dispiace book - Amazon.it</title>" + card(asins[0]!) });
    });
    const out = await getPublicApiScraper(page, "amazon-search", { query: "Ci dispiace", marketplace: "amazon.it", limit: 1 });
    assert.equal(out.count, 1);
    assert.equal(calls, 1);
  }));

test("Italian search uses the native form action and preserves filters and pages", () => {
  const url = new URL(amazonSearchUrl({ query: "cuffie", min_price: 10 }, "amazon.it", 2));
  assert.equal(url.pathname, "/s/ref=nb_sb_noss");
  assert.equal(url.searchParams.get("k"), "cuffie");
  assert.equal(url.searchParams.get("low-price"), "10");
  assert.equal(url.searchParams.get("page"), "2");
});

test("Canadian anonymous startup completes the button-only shopping welcome", async () =>
  withPage(async (page) => {
    let welcomes = 0;
    await page.route("https://www.amazon.ca/**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/")
        return route.fulfill({
          contentType: "text/html",
          body: 'Click the button below to continue shopping<form method="get" action="/errors_page/validateCaptcha"><input type="hidden" name="token" value="test"><button type="submit">Continue shopping</button></form>',
        });
      if (url.pathname.includes("validateCaptcha")) welcomes++;
      return route.fulfill({ contentType: "text/html", body: card(asins[0]!, "$44.99") });
    });
    await page.goto("https://www.amazon.ca/");
    const out = await getPublicApiScraper(page, "amazon-search", { marketplace: "amazon.ca", query: "headphones", limit: 1 });
    assert.equal(out.count, 1);
    assert.equal(welcomes, 1);
  }));

for (const challenge of [
  '<input id="captchacharacters">',
  '<img src="/captcha/image.jpg">',
  "Continued access by an unauthorized AI agent",
]) {
  test(`Canadian startup never submits a challenge: ${challenge}`, async () =>
    withPage(async (page) => {
      let submissions = 0;
      await page.route("https://www.amazon.ca/**", (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/")
          return route.fulfill({
            contentType: "text/html",
            body: `Click the button below to continue shopping${challenge}<form method="get" action="/errors_page/validateCaptcha"><button>Continue shopping</button></form>`,
          });
        if (url.pathname.includes("validateCaptcha")) submissions++;
        return route.fulfill({ contentType: "text/html", body: card(asins[0]!) });
      });
      await page.goto("https://www.amazon.ca/");
      await getPublicApiScraper(page, "amazon-search", { marketplace: "amazon.ca", query: "headphones", limit: 1 });
      assert.equal(submissions, 0);
    }));
}

test("UK HTTP-200 service-unavailable pages retry and recover", async () =>
  withPage(async (page) => {
    let calls = 0;
    await page.route("https://www.amazon.co.uk/s?**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: ++calls === 1 ? "<title>503 - Service Unavailable Error</title>We're sorry" : card(asins[0]!, "£44.99"),
      }),
    );
    const out = await getPublicApiScraper(page, "amazon-search", { marketplace: "amazon.co.uk", query: "headphones", limit: 1 });
    assert.equal(out.count, 1);
    assert.equal(calls, 2);
    assert.equal(out.results[0]?.price_currency, "GBP");
  }));

test("Canadian search uses its native public form action", () => {
  const url = new URL(amazonSearchUrl({ query: "wireless headphones" }, "amazon.ca", 2));
  assert.equal(url.pathname, "/s/ref=nb_sb_noss");
  assert.equal(url.searchParams.get("page"), "2");
});
test("Canadian bilingual HTTP-200 temporary errors recover without an empty success", async () =>
  withPage(async (page) => {
    let calls = 0;
    await page.route("https://www.amazon.ca/s/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: ++calls === 1 ? "<title>Amazon.ca Something Went Wrong / Quelque chose s'est mal passé</title>" : card(asins[0]!, "$44.99"),
      }),
    );
    const out = await getPublicApiScraper(page, "amazon-search", { marketplace: "amazon.ca", query: "headphones", limit: 1 });
    assert.equal(out.count, 1);
    assert.equal(calls, 2);
    assert.equal(out.results[0]?.price_currency, "CAD");
  }));

test("interrupted public navigation retries once in the same session", async () => {
  await withPage(async (page) => {
    let requests = 0;
    await page.route("https://www.amazon.it/s*", async (route) => {
      requests++;
      if (requests === 1) return route.abort("aborted");
      await route.fulfill({ contentType: "text/html", body: card(asins[0]) });
    });
    await navigateAmazon(page, "https://www.amazon.it/s?k=cuffie", "[data-asin]");
    assert.equal(requests, 2);
  });
});

test("repeated interrupted navigation becomes a bounded temporary error", async () => {
  await withPage(async (page) => {
    let requests = 0;
    await page.route("https://www.amazon.in/s*", async (route) => {
      requests++;
      await route.abort("aborted");
    });
    await assert.rejects(navigateAmazon(page, "https://www.amazon.in/s?k=headphones", "[data-asin]"), /Amazon navigation was interrupted/);
    assert.equal(requests, 2);
  });
});

test("Canadian shopping startup timeouts use the bounded temporary-error recovery", async () => {
  const error = Object.assign(new Error("page.waitForLoadState: Timeout"), { name: "TimeoutError" });
  const page = {
    url: () => "https://www.amazon.ca/",
    waitForLoadState: async () => {
      throw error;
    },
  } as unknown as Page;
  await assert.rejects(navigateAmazon(page, "https://www.amazon.ca/s?k=headphones", "[data-asin]"), (error) =>
    isRetryableAmazonPublicError(error),
  );
});

test("new-release root carousels return actual ranked products", async () => {
  await withPage(async (page) => {
    await page.route("**/*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<div class="zg-carousel-general-faceout"><span class="zg-bdg-text">#1</span><div class="p13n-sc-uncoverable-faceout" id="B0C3HCD34R"><a href="/dp/B0C3HCD34R"><img alt="Calendar"><div class="p13n-sc-css-line-clamp-3">Calendar</div></a>${htmlPrice("$12.99")}</div></div>`,
      }),
    );
    const out = await getPublicApiScraper(page, "amazon-new-releases", { limit: 2 });
    schema("amazon-new-releases", out);
    assert.equal(out.count, 1);
    assert.equal(out.results[0]!.asin, "B0C3HCD34R");
    assert.equal(out.results[0]!.title, "Calendar");
    assert.equal(out.results[0]!.rank, 1);
  });
});

test("the empty all-department Movers chart returns an explicit upstream notice", async () => {
  await withPage(async (page) => {
    await page.route("**/*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<title>Amazon.com Movers &amp; Shakers</title><h1>Movers &amp; Shakers</h1><h2>About Movers &amp; Shakers</h2><p>Our biggest gainers in sales rank.</p>`,
      }),
    );
    page.waitForFunction = (async () => {
      throw Error("No cards appeared");
    }) as any;
    const out = await getPublicApiScraper(page, "amazon-movers-and-shakers", { limit: 2 });
    schema("amazon-movers-and-shakers", out);
    assert.equal(out.count, 0);
    assert.match(String(out.data?.notice), /no entries/i);
    assert.equal(out.pagination.has_next_page, false);
  });
});
