# Contributing

Use Node.js 22 or newer. Install dependencies with `npm ci` and the browser with `npx playwright install chromium`.

Before submitting a change, run `npm run check`, `npm run build` and `npm test`. Add a fixture regression test when fixing extraction, pagination, input handling, or blocked-page detection.

Use `npm run smoke -- --only=amazon-search` for a real upstream check relevant to your change. Report the date, marketplace, browser mode, whether a proxy was used, and the result. Fixture tests and live access are separate evidence. Do not add credentials, cookies, personal information or private browser state to fixtures or reports.

Keep all endpoints runnable without an account, API key or paid provider. Missing data should stay null; blocked pages should fail explicitly. Document reduced review coverage and partial product failures.

For bug reports, include the command, Node version, marketplace, expected behavior and observed error. Check that screenshots and logs contain no secrets.
