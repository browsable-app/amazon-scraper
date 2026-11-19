import type { Page } from "playwright";
import { getAmazonPublic, isAmazonPublicSource } from "./getAmazonPublic.js";
import { getAmazonReviews } from "./getAmazonReviews.js";
import type { AmazonInput } from "./amazonCommon.js";
export async function getPublicApiScraper(page: Page, source: string, input: AmazonInput) {
  if (source === "amazon-reviews") return getAmazonReviews(page, input);
  if (isAmazonPublicSource(source)) return getAmazonPublic(page, source, input);
  throw new Error(`Unknown Amazon endpoint: ${source}`);
}
