# Amazon Scraper

Scrape Amazon products, prices, offers, variants, product lists and sellers with local Playwright Chromium.

**Free source code, MIT licensed. Runs locally without a Browsable account, API key, hosted browser or paid service.** All extraction code is included in this repository.

## Quick start

Requires Node.js 22 or newer.

```bash
git clone https://github.com/browsable-app/amazon-scraper.git
cd amazon-scraper
npm ci
npx playwright install chromium
npm run scrape -- search --marketplace amazon.co.uk --query "kindle" --limit 2
npm run scrape -- product --marketplace amazon.co.uk --asin B0CX8MQF7R
```

On Linux, install Chromium's system dependencies with `npx playwright install --with-deps chromium`.

Amazon may show access checks, require sign-in, or return different content depending on your IP address and delivery location. The scraper reports blocked requests as errors. Free software does not guarantee access from every network. See [local validation results](docs/VALIDATION.md).

## Available endpoints

| CLI command | Public endpoint | Data |
| --- | --- | --- |
| `search` | `amazon/search` | Product search, filters, sorting and pagination |
| `product` | `amazon/asin` | Product title, price, images, specifications and availability |
| `price` | `amazon/price` | Current price and availability, with product context |
| `best-sellers` | `amazon/best-sellers` | Best sellers by department |
| `deals` | `amazon/deals` | Deals page or discounted products matching a query |
| `offers` | `amazon/product/offers` | Seller offers, condition, shipping and featured-offer status |
| `variations` | `amazon/product/variations` | Child ASINs and attributes; optional product details |
| `batch` | `amazon/products/batch` | Up to ten ASINs, with individual product errors |
| `new-releases` | `amazon/new-releases` | Ranked new releases |
| `seller` | `amazon/seller/products` | A seller's public product catalogue |

These are local operations. This repository does not start an HTTP server. The CLI and library also accept endpoint paths and full names such as `amazon-product-offers`.

```bash
npm run scrape -- --help
npm run scrape -- --list
npm run scrape -- search --query headphones --min-price 20 --max-price 100 --min-rating 4 --sort price_asc --limit 10
npm run scrape -- product --url https://www.amazon.co.uk/dp/B0C3HCD34R
npm run scrape -- offers --asin B0C3HCD34R --condition new --limit 5
npm run scrape -- variations --asin B0C3HCD34R --include-details --limit 5
npm run scrape -- batch --asins B0C3HCD34R,B085DV8T75
npm run scrape -- best-sellers --category electronics --limit 10
npm run scrape -- new-releases --category electronics --limit 10
npm run scrape -- deals --query "coffee grinder" --limit 10
npm run scrape -- seller --seller-id A294P4X9EWVXLJ --limit 10
```

See the [endpoint reference](docs/ENDPOINTS.md) for fields and limits.

## Save results

```bash
npm run scrape -- search --query headphones --limit 10 --output products.json
npm run scrape -- search --query headphones --limit 10 --format csv --output products.csv
```

JSON includes results, marketplace and delivery metadata, pagination, and per-product errors where applicable. CSV exports the result rows; nested fields are JSON strings. Partial-batch errors are also written to stderr when exporting CSV.

For machine-readable stdout without npm's command banner, build and run the CLI directly:

```bash
npm run build
node dist/cli.js search --query headphones --limit 2
```

Errors go to stderr as JSON and return a nonzero exit code.

## Use from JavaScript or TypeScript

Build the repository first with `npm run build`. The package has not been published to npm; examples import the local build.

```js
import { scrape } from './dist/index.js';

const first = await scrape('search', {
  query: 'wireless headphones',
  marketplace: 'amazon.com',
  limit: 10,
});
console.log(first.results);

if (first.pagination.next_cursor) {
  const second = await scrape('search', {
    query: 'wireless headphones',
    marketplace: 'amazon.com',
    limit: 10,
    cursor: first.pagination.next_cursor,
  });
  console.log(second.results);
}
```

Reuse the same filters and marketplace when continuing a cursor. Cursors retain unused rows and previously returned IDs. They are not signed credentials and should not be treated as trusted input in a hosted service.

To reuse a browser session, call `scrapeWithPage(page, endpoint, input)`. You own that page and its browser lifecycle. `scrape()` launches and closes its own browser and defaults to a three-minute overall timeout.

```js
import { chromium } from 'playwright';
import { scrapeWithPage } from './dist/index.js';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const result = await scrapeWithPage(page, 'product', { asin: 'B0C3HCD34R' });
  console.log(result.results);
} finally {
  await browser.close();
}
```

## Marketplaces and delivery

Recognized marketplaces: `amazon.com`, `amazon.co.uk`, `amazon.ca`, `amazon.de`, `amazon.fr`, `amazon.it`, `amazon.es`, `amazon.co.jp`, `amazon.in`, and `amazon.com.au`. Recognition does not imply every endpoint has been validated live in every market.

Set `--marketplace amazon.de` or supply a product URL. The URL and explicit marketplace must agree. Country aliases such as `UK` and `DE` are accepted. Use `--postal-code 10001` to request a delivery location. The operation fails if Amazon cannot apply it. Postal codes do not change your IP address or provide a regional proxy.

Prices retain the displayed text and include a normalized decimal string and currency when available. A recognized displayed currency overrides the marketplace default. Missing prices remain `null`. Shipping totals remain `null` when shipping depends on order value, membership, or another unknown condition.

## Partial results

Batch runs report failed products in `data.errors`; an all-failed batch raises an error. Variation detail failures are also reported in `data.errors`.

## Troubleshooting

- **Browser missing:** run `npx playwright install chromium`.
- **Access check:** try `--headed` to inspect the response or retry later. CAPTCHA solving and automatic access-check bypass are not included.
- **Timeout:** increase `--timeout-ms 240000` for a slow connection or batch.
- **Regional results differ:** check `marketplace` and returned `delivery_location`.
- **Markup changed:** open an issue with the command, marketplace and error, without cookies or credentials.

A user-supplied proxy is optional. Set `AMAZON_PROXY_SERVER`, and optionally `AMAZON_PROXY_USERNAME` and `AMAZON_PROXY_PASSWORD`, or pass a Playwright `proxy` object to `scrape()`. No provider integration or proxy purchase is included. Credentials should stay in your environment, not command arguments or committed files.

## Development

```bash
npm ci
npx playwright install chromium
npm run check
npm run build
npm test
npm run smoke
```

Tests use local Chromium and intercepted fixture responses. `npm run smoke` makes real Amazon requests for all ten operations, requires at least one result per operation, checks output contracts, exercises search continuation when available, and writes `output/live-validation.json`. It exits nonzero if any check fails. Use `npm run smoke -- --only=amazon-search` to select checks, or add `--headed`.

## Maintenance and license

See [contributing](CONTRIBUTING.md), [source provenance](docs/PROVENANCE.md), and [MIT license](LICENSE).

Built by [Browsable](https://browsable.app). If you prefer a hosted scraping API, visit the website. The local scraper works independently.
