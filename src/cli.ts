#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { endpoints, scrape } from "./index.js";
import type { AmazonInput } from "./amazonCommon.js";

export function toCsv(rows: Record<string, unknown>[]): string {
  const columns = [...new Set(rows.flatMap(Object.keys))];
  const cell = (value: unknown) => '"' + (value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value)).replace(/"/g, '""') + '"';
  if (!columns.length) return "";
  return [columns.map(cell).join(","), ...rows.map(row => columns.map(key => cell(row[key])).join(","))].join("\n") + "\n";
}
const help = `Usage: npm run scrape -- <endpoint> [options]

Endpoints: search, product, price, best-sellers, deals, offers, variations,
           batch, new-releases, seller
Also accepts full names (amazon-search) and paths (amazon/product/offers).

--query TEXT       --asin ASIN          --url HTTPS_URL
--marketplace DOMAIN (default amazon.com)   --postal-code CODE
--limit N          --page N             --cursor CURSOR
--category TEXT    --category-id ID     --brand TEXT
--min-price N      --max-price N        --min-rating N
--sort relevance|price_asc|price_desc|rating|newest
--seller-id ID     --seller-url URL     --condition all|new|used|renewed
--asins ASIN,ASIN  --include-details    --headed
--input FILE      JSON input object; explicit flags override file fields
--output FILE     --format json|csv    --timeout-ms N (default 180000)
--list            --help

Optional user-supplied proxy: AMAZON_PROXY_SERVER, AMAZON_PROXY_USERNAME,
AMAZON_PROXY_PASSWORD. No proxy or API key is required by default.
`;
async function main() {
  const strings = ["query", "asin", "url", "marketplace", "postal-code", "limit", "page", "cursor", "category", "category-id", "brand", "min-price", "max-price", "min-rating", "sort", "seller-id", "seller-url", "condition", "asins", "input", "output", "format", "timeout-ms"];
  const options: Record<string, { type: "string" | "boolean" }> = Object.fromEntries(strings.map(name => [name, { type: "string" }]));
  for (const name of ["include-details", "headed", "list", "help"]) options[name] = { type: "boolean" };
  const { values, positionals } = parseArgs({ options, allowPositionals: true, strict: true });
  if (values.help || (!positionals.length && !values.list)) { process.stdout.write(help); return; }
  if (values.list) { process.stdout.write(JSON.stringify(endpoints, null, 2) + "\n"); return; }
  if (positionals.length !== 1) throw Error("Supply exactly one endpoint.");
  const format = values.format ?? "json";
  if (!["json", "csv"].includes(String(format))) throw Error("--format must be json or csv");
  const input: AmazonInput = values.input ? JSON.parse(await readFile(String(values.input), "utf8")) : {};
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("--input must contain a JSON object");
  const numeric = new Set(["limit", "page", "min-price", "max-price", "min-rating"]);
  for (const [key, value] of Object.entries(values)) {
    if (["input", "output", "format", "timeout-ms", "headed", "list", "help"].includes(key)) continue;
    input[key.replaceAll("-", "_")] = numeric.has(key) ? Number(value) : key === "asins" ? String(value).split(",").map(v => v.trim()) : value;
  }
  const proxy = process.env.AMAZON_PROXY_SERVER ? { server: process.env.AMAZON_PROXY_SERVER, username: process.env.AMAZON_PROXY_USERNAME, password: process.env.AMAZON_PROXY_PASSWORD } : undefined;
  const result = await scrape(positionals[0], input, { headless: !values.headed, timeoutMs: values["timeout-ms"] ? Number(values["timeout-ms"]) : undefined, proxy });
  const output = format === "csv" ? toCsv(result.results) : JSON.stringify(result, null, 2) + "\n";
  if (values.output) await writeFile(String(values.output), output);
  else process.stdout.write(output);
  if (format === "csv" && (result.data?.notice || result.data?.failed)) process.stderr.write(JSON.stringify(result.data) + "\n");
}
// Importing toCsv in tests must not execute the CLI.
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ success: false, error: error.message, error_code: error.error_code ?? "scrape_failed" }) + "\n");
    process.exitCode = 1;
  });
}
