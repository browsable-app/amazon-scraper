import type { Page } from "playwright";
import { getAmazonPublic, isAmazonPublicSource } from "./getAmazonPublic.js";
import type { AmazonInput } from "./amazonCommon.js";
export async function getPublicApiScraper(page: Page, source: string, input: AmazonInput) {
  if (isAmazonPublicSource(source)) return getAmazonPublic(page, source, input);
  throw new Error(`Unknown Amazon endpoint: ${source}`);
}
