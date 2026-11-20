# Source provenance

Initial port: 2026-11-19.

Source snapshot: `7855b43f186e8ad4bbdb124ee26aa490382fd4d4` in Browsable's internal repository.

The port includes the Amazon public extraction implementation, common marketplace/price/cursor helpers, offer and variation extractors, public input/output contracts, and Amazon regression fixtures. A legacy search extractor is retained for its existing regression coverage.

Standalone changes:

- Launch local Playwright Chromium instead of provisioning a hosted browser.
- Remove provider routing and account-bound regional proxy configuration.
- Replace private cross-workspace imports with local Amazon input normalization, public errors, schemas and validation.
- Remove task billing metadata and external review-reader fallback.
- Add an independent CLI, library, browser cleanup, run deadline, CI and documentation.
- Correct price currency when Amazon displays a currency different from the marketplace default.

No internal Git history, credentials, account configuration or provider environment files are included.

Maintenance: review relevant internal Amazon fixes for a public backport, and public fixes for an internal backport. Record the public release in the changelog. Each backport should include a fixture regression and a relevant live check where network access permits it. This repository is independently installable and does not require a private shared package.
