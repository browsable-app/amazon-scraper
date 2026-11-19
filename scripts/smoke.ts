import { mkdir, writeFile } from "node:fs/promises";
import { scrape, amazonTaskDefinitions } from "../src/index.js";
import { validateJsonSchemaValue } from "../src/validation.js";
const cases: [string, Record<string, unknown>][] = [
  ["amazon-search", { query: "wireless headphones", limit: 2 }],
  ["amazon-asin", { asin: "B0C3HCD34R" }],
  ["amazon-price", { asin: "B0C3HCD34R" }],
  ["amazon-best-sellers", { category: "electronics", limit: 2 }],
  ["amazon-deals", { query: "coffee grinder", limit: 2 }],
  ["amazon-product-offers", { asin: "B0C3HCD34R", limit: 2 }],
  ["amazon-product-variations", { asin: "B0C3HCD34R", limit: 2 }],
  ["amazon-products-batch", { asins: ["B0C3HCD34R", "B085DV8T75"] }],
  ["amazon-movers-and-shakers", { category: "electronics", limit: 2 }],
  ["amazon-new-releases", { category: "electronics", limit: 2 }],
  ["amazon-seller-products", { seller_id: "A294P4X9EWVXLJ", limit: 2 }],
  ["amazon-reviews", { asin: "B0C3HCD34R", limit: 2 }],
];
const only = process.argv.find(v => v.startsWith("--only="))?.slice(7);
const selected = cases.filter(([name]) => !only || new RegExp(only).test(name));
if (!selected.length) throw Error("No smoke cases matched --only");
const results: Record<string, unknown>[] = [];
const report = { recorded_at: new Date().toISOString(), node: process.version, marketplace: "amazon.com", headless: !process.argv.includes("--headed"), proxy: false, results };
await mkdir("output", { recursive: true });
for (const [endpoint, input] of selected) {
  const started = Date.now();
  let entry: Record<string, unknown>;
  try {
    const output = await scrape(endpoint, input, { timeoutMs: 60_000, headless: report.headless });
    const definition = amazonTaskDefinitions.find(d => d.builtin === endpoint);
    if (definition) {
      const check = validateJsonSchemaValue(definition.outputSchema, output);
      if (!check.valid) throw Error("Output schema mismatch: " + JSON.stringify(check.errors));
    }
    entry = { endpoint, input, outcome: "passed", count: output.count, duration_ms: Date.now() - started, sample: output.results[0] ?? null, metadata: output.data };
    // Exercise continuation on a real list rather than treating a cursor's presence as proof.
    if (endpoint === "amazon-search" && output.pagination.next_cursor) {
      const next = await scrape(endpoint, { ...input, cursor: output.pagination.next_cursor }, { timeoutMs: 60_000, headless: report.headless });
      const ids = new Set(output.results.map(row => row.id));
      if (next.results.some(row => ids.has(row.id))) throw Error("Live pagination repeated product IDs");
      entry.pagination = { outcome: "passed", count: next.count };
    }
  } catch (error) {
    entry = { endpoint, input, outcome: "failed", error: (error as Error).message, duration_ms: Date.now() - started };
    process.exitCode = 1;
  }
  results.push(entry);
  process.stdout.write(JSON.stringify({ endpoint, outcome: entry.outcome, count: entry.count, error: entry.error }) + "\n");
  await writeFile("output/live-validation.json", JSON.stringify(report, null, 2) + "\n");
}
