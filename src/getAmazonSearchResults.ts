import type { Page } from "playwright";

export interface AmazonSearchResult {
  name: string | null;
  link: string | null;
  price: string | null;
  images: string[];
  rating: number | null;
  numberOfReviews: number | null;
  tags: string[];
}

export async function extractSearchResultsFromPage(page: Page): Promise<AmazonSearchResult[]> {
  // Initialize __name globally to fix bundling issues with arrow functions
  await page.evaluateHandle(() => {
    if (typeof (window as any).__name === "undefined") {
      (window as any).__name = (func: any) => func;
    }
  });

  const results = await page.evaluate(() => {
    // Define helper functions inside evaluate to avoid bundling issues
    const cleanText = (txt: any) => {
      return txt ? txt.replace(/\s+/g, " ").trim() : null;
    };

    const parseReviewsCount = (str: any) => {
      if (!str) return null;
      str = str.replace(/[^\d\.KMB\+]/g, "");
      if (str.endsWith("K")) return Math.round(parseFloat(str) * 1000);
      if (str.endsWith("M")) return Math.round(parseFloat(str) * 1000000);
      if (str.endsWith("B")) return Math.round(parseFloat(str) * 1000000000);
      return parseInt(str.replace(/[^\d]/g, ""), 10) || null;
    };

    // Main logic
    const results: any[] = [];
    // Select all search result items (that are not ads etc.)
    document.querySelectorAll('[data-component-type="s-search-result"]').forEach((item) => {
      // TITLE & LINK
      const titleA = item.querySelector(
        "a:has(h2), h2 a, .a-link-normal.s-line-clamp-3, .a-link-normal.s-line-clamp-2, .a-link-normal.s-line-clamp-1",
      );
      let name = null,
        link = null;
      if (titleA) {
        const h2 = titleA.querySelector("h2 span");
        name = cleanText(h2 ? h2.textContent : titleA.textContent);
        link = titleA.getAttribute("href");
        if (link) link = new URL(link, location.origin).toString();
        const asin = item.getAttribute("data-asin");
        if (asin && /^[a-z0-9]{10}$/i.test(asin)) link = `${location.origin}/dp/${asin.toUpperCase()}`;
      }

      // IMAGE(S)
      let img = item.querySelector("img.s-image") as HTMLImageElement | null;
      let images: string[] = [];
      if (img) {
        // srcset contains several image sizes, split them for all versions
        images = [img.src];
        // Optionally get higher-res images too
        if (img.srcset) {
          img.srcset.split(",").forEach((im) => {
            const src = im.trim().split(" ")[0];
            if (src && images.indexOf(src) === -1) images.push(src);
          });
        }
      }

      // PRICE (Look for "THB ..." or $ or other currency)
      let price = null;
      let priceElem = item.querySelector(".a-price:not(.a-text-price) .a-offscreen");
      if (priceElem) price = cleanText(priceElem.textContent);

      // RATING
      let ratingElem = item.querySelector(".a-icon-star-mini .a-icon-alt") || item.querySelector(".a-size-small.a-color-base, .a-icon-alt");
      let rating = null;
      if (ratingElem) {
        let txt = ratingElem.textContent || "";
        // Format: "4.6 out of 5 stars"
        let m = txt.match(/([\d\.]+)\s*out\s*of\s*5/);
        rating = m?.[1] ? parseFloat(m[1]) : parseFloat(txt) || null;
      }
      // Number of REVIEWS
      let reviewElem = item.querySelector(
        '[aria-label$="ratings"], [aria-label$="reviews"], .a-size-mini.puis-normal-weight-text.s-underline-text',
      );
      // Sometimes wrapped in a .a-size-mini ... (see review counts)
      if (!reviewElem) reviewElem = item.querySelector(".a-size-mini.puis-normal-weight-text.s-underline-text");
      let numberOfReviews = parseReviewsCount(reviewElem ? reviewElem.textContent : "");

      // TAGS
      // Tags are found as badges, (ex: 'Best Seller'), flavor/size, attributes (ex: Milk Chocolate, 1.5 Ounce, 3 sizes/8 flavors, etc)
      let tags: string[] = [];
      // Amazon badges (Best Seller, New, etc)
      item.querySelectorAll(".rio-badge-label, .s-variation-options-link span, .s-background-color-platinum").forEach((e) => {
        let txt = cleanText(e.textContent);
        if (txt && !tags.includes(txt)) tags.push(txt);
      });
      // Sometimes options are in aria-label of links:
      item.querySelectorAll("a.s-variation-options-link").forEach((a) => {
        let t = a.getAttribute("aria-label");
        if (t) tags.push(t);
      });

      // "Bought in past month" or "flavor" lines
      Array.from(item.querySelectorAll(".a-row.a-size-base")).forEach((node) => {
        let txt = cleanText(node.textContent);
        if (txt && /(bought|flavor|pack|option)/i.test(txt)) tags.push(txt);
      });

      // Deduplicate tags
      tags = Array.from(new Set(tags.map(cleanText))).filter(Boolean) as string[];

      if (!name || !link) return;
      results.push({
        name,
        link,
        price,
        images,
        rating,
        numberOfReviews,
        tags,
      });
    });

    return results;
  });

  return results;
}

export async function getAmazonSearchResults(
  page: Page,
  query: string,
  domain: string = "amazon.com",
  maxResults: number = 500,
): Promise<AmazonSearchResult[]> {
  if (!query) {
    throw new Error("Query is required");
  }

  await page.goto(`https://${domain}/s?k=${encodeURIComponent(query)}`);

  // Accumulate search results across all pages
  const allResults: AmazonSearchResult[] = [];
  const seen = new Set<string>();
  const visitedPages = new Set<string>();

  while (allResults.length < maxResults) {
    // Extract search results from the current page
    const pageResults = await extractSearchResultsFromPage(page);
    for (const result of pageResults) {
      if (!result.link) continue;
      let decoded = result.link;
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        /* Keep the original URL. */
      }
      const key = decoded.match(/\/(?:dp|gp\/product)\/([a-z0-9]{10})(?:[/?#]|$)/i)?.[1]?.toUpperCase() ?? result.link.split("?")[0]!;
      if (seen.has(key)) continue;
      seen.add(key);
      allResults.push(result);
    }

    // Stop if we've reached the max number of results
    if (allResults.length >= maxResults) {
      break;
    }

    // Navigate explicitly so extraction cannot race an unfinished next-page click.
    const nextPageUrl = await page.evaluate(() => {
      const nextButton = document.querySelector("a.s-pagination-next");
      if (nextButton && !nextButton.parentElement?.classList.contains("s-pagination-disabled")) {
        return (nextButton as HTMLAnchorElement).href;
      }
      return null;
    });

    // If there's no next page, break the loop
    if (!nextPageUrl || visitedPages.has(nextPageUrl)) {
      break;
    }
    visitedPages.add(nextPageUrl);
    const nextUrl = new URL(nextPageUrl);
    if (nextUrl.hostname.replace(/^www\./, "") !== new URL(`https://${domain}`).hostname.replace(/^www\./, "") || nextUrl.pathname !== "/s")
      break;
    await page.goto(nextPageUrl, { waitUntil: "domcontentloaded" });
  }

  // Slice to enforce max results limit
  return allResults.slice(0, maxResults);
}
