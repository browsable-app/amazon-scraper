# Local validation for November 20, 2026

All ten current operations returned records and passed output schema validation using local headless Chromium on macOS arm64 with Node 22.23.4 and Playwright 1.65.1. The checks used no Amazon account, API key, proxy or paid service. Type checking, build, package-content checks and all 49 automated tests also passed.

| Operation | Storefront | Live result |
| --- | --- | --- |
| Search | UK | Two products and two distinct continuation results |
| Product details | UK | One requested product |
| Price | UK | One requested product |
| Best sellers | US | Two ranked products |
| Deals | US | Two products from the default deals page |
| Offers | UK | One offer |
| Variations | UK | One row for the smoke-test product and two distinct variants in a separate check |
| Batch | UK | Both requested products |
| New releases | US | Two ranked products |
| Seller products | UK | Two products |

The initial US-only run also encountered automated access checks and HTTP 503 responses. Alternative public inputs or the UK storefront produced data for operations affected by those failures. These results cover the tested inputs and storefronts. Access can vary by network, delivery location and time.

Two operations were removed. Reviews produced no review rows across two products. The initial US request returned HTTP 404 and the second hit an access check. The November 19 check also encountered a sign-in requirement. Movers and shakers returned zero rows for the US all-department, electronics, books and kitchen pages and for UK electronics.

[Evidence for the November 20 checks](validation/local-2026-11-20.json) · [Historical November 19 report data](validation/local-2026-11-19.json)

## Repeat the checks

```bash
npm ci
npx playwright install chromium
npm run check
npm run build
npm test
npm run smoke
```

The smoke suite requires a non-empty result from each sample and checks its schema. It exits nonzero if a sample fails and writes the results to `output/live-validation.json`. To run a single case, use `npm run smoke -- --only=amazon-search`.
