import { createHash } from "node:crypto";
import type { Page } from "playwright";
import type { AmazonInput } from "./amazonCommon.js";
import { amazonMarketplace, amazonLimit, amazonScope, decodeAmazonCursor, encodeAmazonCursor } from "./amazonCommon.js";
import { amazonProductUrl, navigateAmazon, applyAmazonLocation } from "./getAmazonPublic.js";
import type { PublicApiScraperOutput } from "./public-api-types.js";

export interface AmazonReview {
  id: string;
  username: string | null;
  avatar: string | null;
  title: string | null;
  rating: number | null;
  location: string | null;
  date: string | null;
  content: string | null;
  images: string[];
  helpfulCount: number | null;
  verifiedPurchase: boolean;
  styleName: string | null;
}

export async function extractReviewsFromPage(page: Page): Promise<AmazonReview[]> {
  const reviews = await page.evaluate(() => {
    const reviews: any[] = Array.from(document.querySelectorAll('[data-hook="review"]')).map((li) => {
      // Username
      const usernameEl = li.querySelector('[data-hook="genome-widget"] .a-profile-name');
      const username = usernameEl ? (usernameEl.textContent?.trim() ?? null) : null;

      // Avatar
      const avatarEl = li.querySelector(".a-profile-avatar img") as HTMLImageElement | null;
      const avatar = avatarEl ? avatarEl.src || avatarEl.getAttribute("data-src") : null;

      // Title
      const titleLink = li.querySelector('a[data-hook="review-title"]');
      let title = null;
      if (titleLink) {
        const spans = titleLink.querySelectorAll("span");
        title = (spans.length ? spans.item(spans.length - 1) : titleLink).textContent?.trim() ?? null;
      }

      // Rating (numeric)
      const ratingAltEl = li.querySelector('[data-hook="review-star-rating"] .a-icon-alt');
      let rating = null;
      if (ratingAltEl) {
        const match = ratingAltEl.textContent?.trim().match(/^([\d.,]+)/);
        rating = match?.[1] ? parseFloat(match[1].replace(",", ".")) : null;
      }

      // Location & Date
      const dateEl = li.querySelector('[data-hook="review-date"]');
      let location = null;
      let date = null;
      if (dateEl) {
        const raw = dateEl.textContent?.trim() ?? ""; // "Reviewed in the United States on July 5, 2025"
        const prefix = "Reviewed in ";
        const prefixIndex = raw.indexOf(prefix);
        if (prefixIndex !== -1) {
          const rest = raw.slice(prefixIndex + prefix.length); // "the United States on July 5, 2025"
          const onIndex = rest.lastIndexOf(" on ");
          if (onIndex !== -1) {
            location = rest.slice(0, onIndex).trim();
            date = rest.slice(onIndex + 4).trim();
          } else {
            date = rest.trim();
          }
        } else {
          // Fallback if format is different
          date = raw;
        }
      }

      // Review content
      const bodyEl = li.querySelector('[data-hook="review-body"] span');
      const content = bodyEl ? (bodyEl.textContent?.trim() ?? null) : null;

      // Images (thumbnail URLs)
      const images = Array.from(li.querySelectorAll('img[data-hook="review-image-tile"]')).map((img) => (img as HTMLImageElement).src);

      // Helpful count - parse from text like "2 people found this helpful"
      const helpfulEl = li.querySelector('[data-hook="helpful-vote-statement"]');
      let helpfulCount: number | null = null;
      if (helpfulEl) {
        const helpfulText = helpfulEl.textContent?.trim() ?? "";
        const helpfulMatch = helpfulText.match(/^(\d+)/);
        if (helpfulMatch?.[1]) {
          helpfulCount = parseInt(helpfulMatch[1], 10);
        } else if (helpfulText.toLowerCase().includes("one person")) {
          helpfulCount = 1;
        }
      }

      // Verified Purchase
      const verifiedEl = li.querySelector('[data-hook="avp-badge"]');
      const verifiedPurchase = !!verifiedEl;

      // Style Name (e.g., "Style Name: 42 Pieces")
      const styleEl = li.querySelector('[data-hook="format-strip"]');
      let styleName: string | null = null;
      if (styleEl) {
        const styleText = styleEl.textContent?.trim() ?? "";
        // Remove "Style Name: " prefix if present
        styleName = styleText.replace(/^Style Name:\s*/i, "").trim() || null;
      }

      return { id: li.id || JSON.stringify([username, title, date, content]), username, avatar, title, rating, location, date, content, images, helpfulCount, verifiedPurchase, styleName };
    });

    return reviews;
  });

  return reviews;
}


/** Read anonymous review listings; fall back only to direct product-page reviews. */
export async function getAmazonReviews(page: Page, input: AmazonInput): Promise<PublicApiScraperOutput> {
  await page.addInitScript(() => { (globalThis as any).__name ??= (fn: unknown) => fn; });
  const marketplace = amazonMarketplace(input.marketplace ?? input.domain, input.url);
  const productUrl = amazonProductUrl({ ...input, marketplace });
  const asin = productUrl.split("/").at(-1)!;
  const limit = amazonLimit(input.limit ?? input.maxReviews, 25);
  const scope = amazonScope("amazon-reviews", { asin, marketplace, postal_code: input.postal_code ?? null });
  const cursor = decodeAmazonCursor(input.cursor, scope, input.page);
  const seen = new Set(cursor.seen);
  const results: Record<string, unknown>[] = [];
  const listing = new URL(`/product-reviews/${asin}`, productUrl);
  listing.searchParams.set("reviewerType", "all_reviews");
  let coverage = "review_listing", nextCursor: string | null = null;
  let delivery: { postal_code: string | null; applied: boolean; displayed: string | null } = {
    postal_code: typeof input.postal_code === "string" ? input.postal_code : null, applied: false, displayed: null,
  };
  if (input.postal_code) {
    await navigateAmazon(page, productUrl, "#productTitle");
    delivery = await applyAmazonLocation(page, String(input.postal_code), productUrl, "#productTitle");
  }
  for (let scan = 0, upstream = cursor.page; scan < 10 && results.length < limit; scan++, upstream++) {
    listing.searchParams.set("pageNumber", String(upstream));
    try {
      await navigateAmazon(page, listing.toString(), '[data-hook="review"], [data-hook="no-reviews-message"]');
    } catch (error) {
      // Listing sign-in walls do not prevent trying the public featured section.
      if (results.length || upstream !== 1 || (!/\/ap\/(?:signin|cvf)/.test(page.url()) && !/did not expose the expected product content/.test((error as Error).message))) throw error;
      coverage = "featured_reviews";
      await navigateAmazon(page, productUrl, "#productTitle");
    }
    const read = async () => (await extractReviewsFromPage(page)).map(row => ({ ...row, id: row.id.length > 180 ? createHash("sha256").update(row.id).digest("hex") : row.id }));
    let rows = await read();
    if (!rows.length && upstream === 1 && coverage === "review_listing") {
      const empty = await page.locator('[data-hook="no-reviews-message"]').count();
      if (empty) break;
      coverage = "featured_reviews";
      await navigateAmazon(page, productUrl, "#productTitle");
      rows = await read();
    }
    if (!rows.length && coverage === "featured_reviews") {
      const signInRequired = /sign in\s+to see customer reviews/i.test(await page.locator("body").innerText());
      const error = new Error(signInRequired ? "Amazon requires sign-in to show customer reviews for this product." : "Amazon did not expose public reviews. The full listing may require sign-in.");
      Object.assign(error, { error_code: signInRequired ? "authentication_required" : "public_reviews_unavailable", retryable: false });
      throw error;
    }
    const onPage = new Set<string>();
    const fresh = rows.filter(row => {
      if (seen.has(row.id) || onPage.has(row.id)) return false;
      onPage.add(row.id); return true;
    });
    const selected = fresh.slice(0, limit - results.length);
    results.push(...selected.map(row => ({ ...row })));
    selected.forEach(row => seen.add(row.id));
    if (coverage === "featured_reviews") break;
    const next = await page.evaluate(() => document.querySelector<HTMLAnchorElement>("li.a-last:not(.a-disabled) a")?.getAttribute("href") ?? null);
    const hasNext = !!next && new URL(next, listing).origin === listing.origin && new URL(next, listing).pathname.startsWith(`/product-reviews/${asin}`);
    if (fresh.length > selected.length || hasNext) {
      nextCursor = encodeAmazonCursor({ v: 1, scope, page: fresh.length > selected.length ? upstream : upstream + 1, seen: [...seen] });
    } else { nextCursor = null; break; }
  }
  return {
    success: true, source: "amazon-reviews", query: null, url: coverage === "featured_reviews" ? productUrl : listing.toString(),
    results, count: results.length, max_results_requested: limit,
    data: { asin, marketplace, delivery_location: delivery, coverage,
      notice: coverage === "featured_reviews" ? "Only featured reviews visible on the product page are included; this is not the full review listing." : "Only publicly accessible review pages are included." },
    pagination: { cursor: typeof input.cursor === "string" ? input.cursor : null, next_cursor: nextCursor, has_next_page: !!nextCursor, count: results.length, strategy: coverage === "featured_reviews" ? "none" : "cursor" },
  };
}
