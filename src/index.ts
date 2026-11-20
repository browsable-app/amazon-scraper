import { chromium, type Page, type LaunchOptions } from "playwright";
import { amazonTaskDefinitions } from "./amazonTaskDefinitions.js";
import { amazonMarketplace, type AmazonInput } from "./amazonCommon.js";
import { normalizePrebuiltTaskInput } from "./normalize-input.js";
import { PublicInputError } from "./errors.js";
import { validateJsonSchemaValue } from "./validation.js";
import { getPublicApiScraper } from "./dispatch.js";
import type { PublicApiScraperOutput } from "./public-api-types.js";

export { amazonTaskDefinitions } from "./amazonTaskDefinitions.js";
export { AMAZON_MARKETPLACES, type AmazonMarketplace, type AmazonInput } from "./amazonCommon.js";
export type { PublicApiScraperOutput, PublicApiPagination } from "./public-api-types.js";
export { PublicInputError } from "./errors.js";
export type Endpoint = typeof amazonTaskDefinitions[number]["builtin"];
export const endpoints = amazonTaskDefinitions.map(def => ({ name: def.builtin, path: def.path, description: def.description }));
export function resolveEndpoint(value: string): string {
  const normalized = value.replace(/^\/+|\/+$/g, "");
  const aliases: Record<string, string> = { product: "amazon-asin", price: "amazon-price", offers: "amazon-product-offers", variations: "amazon-product-variations", batch: "amazon-products-batch", seller: "amazon-seller-products" };
  const found = endpoints.find(e => e.name === normalized || e.path === normalized || e.name === `amazon-${normalized}`);
  const result = found?.name ?? (Object.hasOwn(aliases, normalized) ? aliases[normalized] : undefined);
  if (!result) throw new PublicInputError("endpoint", `Unknown endpoint: ${value}. Use --list to see available endpoints.`);
  return result;
}
export function validateInput(endpoint: string, input: AmazonInput) {
  const source = resolveEndpoint(endpoint);
  const normalized = normalizePrebuiltTaskInput(source, input);
  if (normalized.issues[0]) throw new PublicInputError(normalized.issues[0].instancePath.slice(1), normalized.issues[0].message);
  const definition = amazonTaskDefinitions.find(def => def.builtin === source);
  if (!definition) throw new PublicInputError("endpoint", `Unknown endpoint: ${endpoint}.`);
  const validation = validateJsonSchemaValue(definition.inputSchema, normalized.input);
  if (!validation.valid) throw new PublicInputError(validation.errors[0]?.instancePath?.slice(1) || "input", JSON.stringify(validation.errors));
  amazonMarketplace(normalized.input.marketplace, normalized.input.url);
  return { source, input: normalized.input };
}

/** Use your own Playwright Page. The caller owns its lifecycle. */
export async function scrapeWithPage(page: Page, endpoint: string, input: AmazonInput = {}): Promise<PublicApiScraperOutput> {
  const validated = validateInput(endpoint, input);
  return getPublicApiScraper(page, validated.source, validated.input);
}
export interface ScrapeOptions {
  headless?: boolean;
  /** Maximum duration of the entire run, including browser startup. */
  timeoutMs?: number;
  proxy?: LaunchOptions["proxy"];
}
/** Launch a local Chromium instance and always close it after the run. */
export async function scrape(endpoint: string, input: AmazonInput = {}, options: ScrapeOptions = {}): Promise<PublicApiScraperOutput> {
  const validated = validateInput(endpoint, input);
  const timeoutMs = options.timeoutMs ?? 180_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new PublicInputError("timeoutMs", "timeoutMs must be positive.");
  const launch = chromium.launch({ headless: options.headless ?? true, proxy: options.proxy, timeout: timeoutMs });
  let browser: Awaited<typeof launch> | undefined;
  let expired = false;
  const timeoutError = Object.assign(new Error(`Amazon scraper exceeded ${timeoutMs}ms`), { error_code: "timeout", retryable: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = async () => {
    browser = await launch;
    if (expired) { await browser.close(); throw timeoutError; }
    const page = await browser.newPage();
    page.setDefaultTimeout(Math.min(timeoutMs, 15_000));
    page.setDefaultNavigationTimeout(Math.min(timeoutMs, 60_000));
    return getPublicApiScraper(page, validated.source, validated.input);
  };
  try {
    return await Promise.race([work(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(timeoutError); }, timeoutMs);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
    if (browser) await browser.close();
  }
}
