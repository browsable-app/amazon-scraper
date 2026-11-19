# Local validation — 2026-11-19

Environment: macOS arm64, Node 22.23.4, Playwright 1.65.1, local headless Chromium. No Amazon account, API key, proxy or paid service was used.

`npm run check`, `npm run build` and all **54 automated tests** passed. Fixture tests abort unmocked network requests. The runtime dependency audit reported no known vulnerabilities at this check. A fresh local clone also passed `npm ci`, type checking, build, all 54 tests, CLI endpoint listing and package-content checks.

## Real Amazon requests

| Operation | Observed outcome |
| --- | --- |
| Search | Two products; continuation returned distinct products |
| Product details | Requested ASIN returned |
| Price | Requested ASIN returned |
| Best sellers | Two ranked products |
| Deals, with query | Zero matching deal products for `coffee grinder` |
| Deals, default page | Two products; Amazon redirected its deals page to the seasonal Black Friday page |
| Offers | One seller offer |
| Variations | Two distinct variants |
| Batch | Both requested products returned |
| Movers and shakers | Explicit upstream empty-category notice; no product rows |
| New releases | Two products |
| Seller products | Two products |
| Reviews | Failed explicitly with `authentication_required`; the live product page said sign-in was required to see customer reviews |

The built CLI also completed real search exports to JSON and CSV. Displayed THB prices were correctly reported as THB rather than inferred USD.

Review extraction, review pagination, featured-review fallback and explicit sign-in failures passed fixture tests. **Anonymous live review extraction was not demonstrated from this environment.**

The sample size is small. These checks establish local operation, not sustained reliability or validation of every filter. Other recognized marketplaces have not been validated live for this release. Empty deal and movers results do not prove non-empty extraction for those particular queries/categories; the separate default deals run did return products.

Machine-readable evidence: [local-2026-11-19.json](validation/local-2026-11-19.json).

## Repeat the checks

```bash
npm ci
npx playwright install chromium
npm run check
npm run build
npm test
npm run smoke
```

The smoke suite attempts every operation and checks returned schemas. It exits nonzero when any operation fails, including sign-in-only reviews. Results are written to `output/live-validation.json`; that directory is ignored by Git. Select cases with `npm run smoke -- --only=amazon-search`.
