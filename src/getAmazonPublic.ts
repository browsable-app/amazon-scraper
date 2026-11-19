import { normalizePrebuiltTaskInput } from "./normalize-input.js";
import { PublicInputError } from "./errors.js";
import type { Page } from "playwright";
import type { PublicApiScraperOutput } from "./public-api-types.js";

import {
  AMAZON_MARKETPLACES,
  AmazonTemporaryError,
  AMAZON_SORTS,
  amazonMarketplace,
  amazonOrigin,
  amazonMoney,
  amazonText,
  amazonLimit,
  amazonScope,
  decodeAmazonCursor,
  encodeAmazonCursor,
  type AmazonMarketplace,
  type AmazonInput,
  type AmazonCursor,
} from "./amazonCommon.js";
import { extractAmazonOffers, extractAmazonVariations } from "./amazonProductExtras.js";
export const AMAZON_PUBLIC_SOURCES = [
  "amazon-search",
  "amazon-asin",
  "amazon-price",
  "amazon-best-sellers",
  "amazon-deals",
  "amazon-product-offers",
  "amazon-product-variations",
  "amazon-products-batch",
  "amazon-movers-and-shakers",
  "amazon-new-releases",
  "amazon-seller-products",
] as const;
export type AmazonSource = (typeof AMAZON_PUBLIC_SOURCES)[number];
export function isAmazonPublicSource(source: string): source is AmazonSource {
  return (AMAZON_PUBLIC_SOURCES as readonly string[]).includes(source);
}

const departments: Record<string, string> = {
  books: "books",
  electronics: "electronics",
  kitchen: "kitchen",
  "kitchen-dining": "kitchen",
  toys: "toys-and-games",
  "toys-games": "toys-and-games",
  "toys-and-games": "toys-and-games",
  beauty: "beauty",
  "beauty-personal-care": "beauty",
  "beauty-and-personal-care": "beauty",
  pets: "pet-supplies",
  "pet-supplies": "pet-supplies",
  baby: "baby-products",
  "baby-products": "baby-products",
  automotive: "automotive",
  appliances: "appliances",
  computers: "pc",
  clothing: "fashion",
  fashion: "fashion",
  grocery: "grocery",
  "grocery-gourmet-food": "grocery",
  "grocery-and-gourmet-food": "grocery",
  health: "hpc",
  "health-household": "hpc",
  "health-and-household": "hpc",
  home: "home-garden",
  "home-kitchen": "home-garden",
  "home-and-kitchen": "home-garden",
  garden: "lawn-garden",
  "patio-lawn-garden": "lawn-garden",
  sports: "sporting-goods",
  "sports-outdoors": "sporting-goods",
  tools: "hi",
  "tools-home-improvement": "hi",
  "office-products": "office-products",
  "video-games": "videogames",
  "musical-instruments": "musical-instruments",
  "arts-crafts-sewing": "arts-crafts",
  "cell-phones-accessories": "wireless",
};

export function amazonBestSellersUrl(
  category: string | null,
  market: AmazonMarketplace = "amazon.com",
  kind: "best-sellers" | "movers-and-shakers" | "new-releases" = "best-sellers",
): string {
  const base = kind === "best-sellers" ? `${amazonOrigin(market)}/Best-Sellers/zgbs` : `${amazonOrigin(market)}/gp/${kind}`;
  if (!category?.trim()) return base;
  const slug = category
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const department = Object.hasOwn(departments, slug) ? departments[slug] : null;
  if (!department)
    throw new Error(`Unsupported Amazon best-sellers category: ${category}. Supported categories: ${Object.keys(departments).join(", ")}`);
  return `${base}/${department}`;
}

export function amazonProductUrl(input: { asin?: unknown; url?: unknown; marketplace?: unknown; domain?: unknown }): string {
  const market = amazonMarketplace(input.marketplace ?? input.domain, input.url);
  let asin = amazonText(input.asin)?.toUpperCase();
  if (input.url) {
    const parsed = new URL(String(input.url));
    const urlAsin = parsed.pathname.match(/\/(?:dp|gp\/product)\/([a-z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase();
    if (!urlAsin) throw new Error("Could not extract ASIN from Amazon product URL");
    if (asin && asin !== urlAsin) throw new Error("Amazon ASIN and URL refer to different products");
    asin = urlAsin;
  }
  if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) throw new Error("A valid 10-character Amazon ASIN or product URL is required");
  return `${amazonOrigin(market)}/dp/${asin}`;
}

// Some anonymous Canadian sessions start on a button-only shopping welcome page.
// Complete only that normal navigation; never submit a challenge or a sign-in form.
async function continueAmazonShopping(page: Page, target: string): Promise<boolean> {
  const origin = new URL(target).origin;
  if (origin !== "https://www.amazon.ca" || new URL(page.url()).origin !== origin) return false;
  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "TimeoutError") throw new AmazonTemporaryError("Amazon shopping startup timed out");
    throw error;
  });
  const eligible = await page.evaluate((origin) => {
    const text = document.body?.innerText || "";
    if (
      !/click the button below to continue shopping/i.test(text) ||
      /unauthorized ai agent|robot check/i.test(text) ||
      document.querySelector("#captchacharacters, input:not([type=hidden]):not([type=submit]), img[src*=captcha]")
    )
      return false;
    const button = Array.from(document.querySelectorAll("button")).find((el) => /^continue shopping$/i.test(el.textContent?.trim() || ""));
    const form = button?.closest("form");
    return Boolean(
      form &&
      new URL(form.action).origin === origin &&
      form.method.toLowerCase() === "get" &&
      Array.from(form.elements).every((el) => el instanceof HTMLButtonElement || (el instanceof HTMLInputElement && el.type === "hidden")),
    );
  }, origin);
  if (!eligible) return false;
  await page.getByRole("button", { name: /^continue shopping$/i }).click({ timeout: 10_000 });
  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "TimeoutError") throw new AmazonTemporaryError("Amazon shopping startup timed out");
    throw error;
  });
  return true;
}

export async function navigateAmazon(page: Page, url: string, selector: string): Promise<void> {
  await continueAmazonShopping(page, url);
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Awaited<ReturnType<Page["goto"]>> = null;
    let interrupted = false;
    try {
      response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    } catch (error) {
      if (!/net::ERR_ABORTED\b/.test(error instanceof Error ? error.message : String(error))) throw error;
      interrupted = true;
      await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
    }
    const status = response?.status() ?? 200;
    const state = await page.evaluate(
      (selector) => ({
        blocked:
          Boolean(document.querySelector("#captchacharacters, form[action*='validateCaptcha']")) ||
          /robot check/i.test(document.title) ||
          /\/ap\/signin/.test(location.pathname) ||
          /continued access by an unauthorized ai agent/i.test(document.body?.innerText || ""),
        temporary:
          !document.querySelector(selector) &&
          /service unavailable|something went wrong|quelque chose s.est mal pass[eé]|we.re sorry|tut uns leid|sorry! something went wrong|ci dispiace|d[ée]sol[ée]|lo sentimos|申し訳ございません|エラーが発生/i.test(
            document.title,
          ),
      }),
      selector,
    );
    if (state.blocked) throw new Error("Amazon request blocked by an automated access check");
    if (interrupted) {
      if (attempt === 0) {
        await page.waitForTimeout(750);
        continue;
      }
      throw new AmazonTemporaryError("Amazon navigation was interrupted (net::ERR_ABORTED)");
    }
    if (!state.blocked && (state.temporary || [429, 500, 502, 503, 504].includes(status)) && attempt === 0) {
      await page.waitForTimeout(750);
      continue;
    }
    if (!state.blocked && (state.temporary || [429, 500, 502, 503, 504].includes(status))) {
      throw new AmazonTemporaryError(`Amazon temporarily unavailable (HTTP ${status})`);
    }
    if (status >= 400) throw new Error(`Amazon did not expose usable public content (${status})`);
    await page
      .waitForFunction(
        (selector) =>
          Boolean(document.querySelector(selector)) ||
          /no results for|did not match any products|no results found|no movers\s*(?:and|&)\s*shakers(?:\s+are)?\s+available|no new releases(?:\s+are)?\s+available/i.test(
            document.body?.innerText || "",
          ),
        selector,
        { timeout: 15_000 },
      )
      .catch(() => undefined);
    const ready = await page.evaluate(
      (selector) =>
        Boolean(document.querySelector(selector)) ||
        /no results for|did not match any products|no results found|no movers\s*(?:and|&)\s*shakers(?:\s+are)?\s+available|no new releases(?:\s+are)?\s+available/i.test(
          document.body?.innerText || "",
        ),
      selector,
    );
    if (!ready) {
      // The all-department Movers page sometimes exposes only its chart
      // description. Preserve that genuine empty public page with a notice;
      // arbitrary blank, blocked and unrelated pages must still fail.
      const emptyMoversRoot = await page.evaluate(
        () =>
          /\/gp\/movers-and-shakers\/?$/.test(location.pathname) &&
          /Movers\s*(?:and|&)\s*Shakers/i.test(document.title) &&
          /About Movers\s*(?:and|&)\s*Shakers/i.test(document.body?.innerText ?? ""),
      );
      if (!emptyMoversRoot) throw new Error("Amazon page did not expose the expected product content");
    }
    return;
  }
}

// Kept self-contained: this function is serialized into the browser by Playwright.
export function extractAmazonProduct() {
  const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, " ").trim() || null;
  const read = (selector: string) => text(document.querySelector(selector));
  const money = (node: Element | null): string | null => {
    if (!node) return null;
    const accessible = text(node.querySelector(".a-offscreen"));
    if (accessible && /[0-9]/.test(accessible)) return accessible;
    const whole = text(node.querySelector(".a-price-whole"))?.replace(/[.,]$/, "");
    const fraction = text(node.querySelector(".a-price-fraction"));
    const symbol = text(node.querySelector(".a-price-symbol")) || "";
    const decimal = /amazon\.(?:de|fr|it|es)$/.test(location.hostname) ? "," : ".";
    return whole ? `${symbol}${whole}${fraction ? decimal + fraction : ""}` : null;
  };
  let price: string | null = null;
  for (const selector of [
    "#corePriceDisplay_desktop_feature_div .priceToPay",
    "#corePriceDisplay_desktop_feature_div .apex-pricetopay-value",
    "#corePrice_feature_div .a-price:not(.a-text-price)",
    "#corePriceDisplay_mobile_feature_div .a-price:not(.a-text-price)",
    "#apex_desktop .priceToPay",
    "#apex_desktop .apex-pricetopay-value",
    "#apex_offerDisplay_desktop .a-price:not(.a-text-price)",
  ]) {
    price = money(document.querySelector(selector));
    if (price) break;
  }
  if (!price) {
    for (const selector of ["#priceblock_ourprice", "#priceblock_dealprice", "#price_inside_buybox", "#newBuyBoxPrice"]) {
      const candidate = read(selector);
      if (candidate && /[0-9]/.test(candidate)) {
        price = candidate;
        break;
      }
    }
  }
  const imageUrls: string[] = [];
  for (const img of document.querySelectorAll("#landingImage, #imgBlkFront, #main-image, #imgTagWrapperId img, #altImages img")) {
    const candidates = [img.getAttribute("data-old-hires"), img.getAttribute("data-src"), img.getAttribute("src")];
    try {
      const dynamic = JSON.parse(img.getAttribute("data-a-dynamic-image") || "{}");
      candidates.unshift(...Object.keys(dynamic).sort((a, b) => (dynamic[b]?.[0] || 0) - (dynamic[a]?.[0] || 0)));
    } catch {
      /* Some gallery thumbnails have no dynamic image data. */
    }
    const hiRes = img.getAttribute("data-old-hires");
    if (hiRes) candidates.unshift(hiRes);
    const image = candidates.find(
      (url) => url && /^https:\/\/(?:m\.media-amazon\.com|images[^/]*\.ssl-images-amazon\.com)\/images\/I\//.test(url),
    );
    if (image && !imageUrls.includes(image)) imageUrls.push(image);
  }
  const details: Record<string, string> = {};
  for (const row of document.querySelectorAll(
    "#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, #productOverview_feature_div tr",
  )) {
    const key = text(row.querySelector("th, td:first-child"))?.replace(/:$/, "");
    const value = text(row.querySelector("td:last-child"));
    if (key && value && key !== value) details[key] = value;
  }
  const asin = (
    document.querySelector<HTMLInputElement>("#ASIN")?.value ||
    location.pathname.match(/\/dp\/([a-z0-9]{10})/i)?.[1] ||
    ""
  ).toUpperCase();
  const availabilityText = read("#availability .primary-availability-message") || read("#availability span") || read("#outOfStock");
  const amount = price?.replace(/[^\d.]/g, "") || null;
  return {
    id: asin,
    asin,
    url: `${location.origin}/dp/${asin}`,
    title: read("#productTitle"),
    description: read("#feature-bullets") || read("#productDescription"),
    price,
    price_amount: amount,
    price_currency: price ? "USD" : null,
    availability:
      availabilityText &&
      /unavailable|out of stock|not in stock|nicht.*verfügbar|rupture|indisponible|non disponibile|no disponible|agotado|在庫切れ/i.test(
        availabilityText,
      )
        ? "OutOfStock"
        : availabilityText &&
            /in stock|only \d+ left|auf lager|en stock|disponibilità immediata|disponibile|在庫あり/i.test(availabilityText)
          ? "InStock"
          : null,
    availability_text: availabilityText,
    rating:
      Number.parseFloat((read("#acrPopover .a-icon-alt") || read("#averageCustomerReviews .a-icon-alt") || "").replace(",", ".")) || null,
    review_count: Number.parseInt((read("#acrCustomerReviewText") || "").replace(/[^\d]/g, ""), 10) || null,
    image_url: imageUrls[0] || null,
    image_urls: imageUrls,
    details,
  };
}

export function extractAmazonCards(kind: "best-sellers" | "deals" | "search-deals" | "search") {
  const clean = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim() || null;
  const text = (node: Element | null) => clean(node?.textContent);
  const selectors =
    kind === "best-sellers"
      ? ".zg-grid-general-faceout, .zg-carousel-general-faceout, #zg-ordered-list [data-asin]"
      : kind === "search-deals" || kind === "search"
        ? "[data-component-type='s-search-result']"
        : ".dcl-product, [data-testid='product-card'], [data-testid='deal-card']";
  const results: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const card of document.querySelectorAll(selectors)) {
    const link = card.querySelector<HTMLAnchorElement>("a[href*='/dp/'], a[href*='/gp/product/']");
    const asin = card.getAttribute("data-asin") || link?.href.match(/\/(?:dp|gp\/product)\/([a-z0-9]{10})/i)?.[1];
    if (!asin || !/^[a-z0-9]{10}$/i.test(asin) || seen.has(asin)) continue;
    const badge = Array.from(
      card.querySelectorAll(".a-badge-text, .a-badge-label-inner, [class*='badgeMessage'], .dcl-badge, [data-cy='deal-badge']"),
    )
      .map(text)
      .filter(Boolean)
      .join(" ");
    // Amazon can ignore obsolete URL refinements. Check the actual badge on each card.
    if (
      kind === "search-deals" &&
      !/limited time deal|lightning deal|deal of the day|top deal|prime.*deal|black friday deal|cyber monday deal/i.test(badge)
    )
      continue;
    const title =
      text(
        card.querySelector(
          ".dcl-product-label, h2, [class*='p13n-sc-css-line-clamp'], [data-testid='product-card-title'], [data-testid='deal-title']",
        ),
      ) || clean(card.querySelector("img")?.getAttribute("alt"));
    if (!title) continue;
    const priceNode = card.querySelector(".a-price:not(.a-text-price)");
    const offscreen = text(priceNode?.querySelector(".a-offscreen") ?? null);
    const whole = text(priceNode?.querySelector(".a-price-whole") ?? null)?.replace(/[.,]$/, "");
    const fraction = text(priceNode?.querySelector(".a-price-fraction") ?? null);
    const rawPrice =
      offscreen ||
      (whole
        ? `${text(priceNode?.querySelector(".a-price-symbol") ?? null) || ""}${whole}${fraction ? (/amazon\.(?:de|fr|it|es)$/.test(location.hostname) ? "," : ".") + fraction : ""}`
        : null) ||
      text(card.querySelector(".p13n-sc-price, [class*='p13n-sc-price'], [class*='price'] .a-offscreen"));
    const price = rawPrice;
    const listPrice = text(card.querySelector(".a-text-price .a-offscreen"));
    const rating = text(card.querySelector(".a-icon-alt")) || card.querySelector("[aria-label*='out of 5']")?.getAttribute("aria-label");
    const image = card.querySelector<HTMLImageElement>("img.s-image, img");
    const url = `${location.origin}/dp/${asin}`;
    const reviewText = text(
      card.querySelector(
        '[data-cy="reviews-block"] .s-underline-text, a .a-size-small .a-size-base, [aria-label$="ratings"], [aria-label$="reviews"]',
      ),
    );
    const countMatch = reviewText?.replace(/,/g, "").match(/([0-9]+(?:\.[0-9]+)?)\s*([KMB])?/i);
    const reviewCount = countMatch
      ? Math.round(Number(countMatch[1]) * ({ K: 1000, M: 1000000, B: 1000000000 }[countMatch[2]?.toUpperCase() as "K" | "M" | "B"] || 1))
      : null;
    results.push({
      id: asin,
      asin,
      title,
      name: title,
      link: url,
      images: image?.src ? [image.src] : [],
      tags: badge ? [badge] : [],
      numberOfReviews: reviewCount,
      is_sponsored: Boolean(
        card.querySelector('[data-component-type="s-sponsored-label-info-icon"], [aria-label="Sponsored"], .puis-sponsored-label-text'),
      ),
      url,
      price,
      price_amount: price?.replace(/[^\d.]/g, "") || null,
      price_currency: price ? "USD" : null,
      list_price: listPrice,
      rating: Number.parseFloat((rating || "").replace(",", ".")) || null,
      image_url: image?.src || null,
      deal_badge: clean(badge),
      rank:
        Number.parseInt(
          (text((card.closest("#gridItemRoot, .zg-item-immersion") || card).querySelector(".zg-bdg-text")) || "").replace(/[^\d]/g, ""),
          10,
        ) || null,
      sales_rank:
        Number.parseInt(
          (text(card.closest("#gridItemRoot, .zg-item-immersion") || card) || "")
            .match(/Sales rank:\s*([0-9,]+)/i)?.[1]
            ?.replace(/,/g, "") || "",
          10,
        ) || null,
      previous_sales_rank:
        Number.parseInt(
          (text(card.closest("#gridItemRoot, .zg-item-immersion") || card) || "").match(/\(was\s*([0-9,]+)\)/i)?.[1]?.replace(/,/g, "") ||
            "",
          10,
        ) || null,
      rank_change_percent:
        Number.parseFloat(
          (
            text(
              (card.closest("#gridItemRoot, .zg-item-immersion") || card).querySelector(".zg-sales-movement, [class*='salesMovement']"),
            ) || ""
          )
            .match(/([0-9,.]+)\s*%/)?.[1]
            ?.replace(/,/g, "") || "",
        ) || null,
    });
    seen.add(asin);
  }
  return results;
}

export function amazonSearchUrl(input: AmazonInput, market: AmazonMarketplace, page = 1): string {
  // Use the observed native search form action for these storefronts.
  const url = new URL(["amazon.it", "amazon.ca"].includes(market) ? "/s/ref=nb_sb_noss" : "/s", amazonOrigin(market));
  const query = amazonText(input.query ?? input.q);
  const seller = amazonText(input.seller_id);
  if (query) url.searchParams.set("k", query);
  if (seller) {
    if (!/^[A-Z0-9]{8,32}$/.test(seller)) throw new Error("seller_id must be an Amazon merchant ID");
    url.searchParams.set("me", seller);
  }
  if (input.sort != null) {
    const sort = AMAZON_SORTS[String(input.sort) as keyof typeof AMAZON_SORTS];
    if (!sort) throw new Error("Unsupported Amazon search sort");
    url.searchParams.set("s", sort);
  }
  for (const [field, parameter] of [
    ["min_price", "low-price"],
    ["max_price", "high-price"],
  ] as const) {
    const value = input[field];
    if (value != null) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${field} must be a nonnegative number`);
      url.searchParams.set(parameter, String(value));
    }
  }
  if (typeof input.min_price === "number" && typeof input.max_price === "number" && input.min_price > input.max_price)
    throw new Error("min_price must not exceed max_price");
  const refinements: string[] = [];
  if (input.min_rating != null) {
    if (![1, 2, 3, 4].includes(Number(input.min_rating))) throw new Error("min_rating must be 1, 2, 3 or 4");
    if (market === "amazon.com" && Number(input.min_rating) === 4) refinements.push("p_72:2661618011");
  }
  const brand = amazonText(input.brand);
  if (brand) {
    if (brand.length > 100 || /[:,]/.test(brand)) throw new Error("brand must be a single brand name without refinement separators");
    refinements.push(`p_89:${brand}`);
  }
  const category = amazonText(input.category);
  if (category) {
    const slug = category
      .toLowerCase()
      .replace(/&/g, " ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const department = Object.hasOwn(departments, slug) ? departments[slug] : null;
    if (!department) throw new Error("Unsupported Amazon search category; use category_id for a specific browse node");
    url.searchParams.set("i", department);
  }
  if (input.category_id != null) {
    if (!/^\d{1,20}$/.test(String(input.category_id))) throw new Error("category_id must be a numeric Amazon browse node ID");
    refinements.push(`n:${input.category_id}`);
  }
  if (refinements.length) url.searchParams.set("rh", refinements.join(","));
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

export async function applyAmazonLocation(page: Page, postalCode: string | null, url: string, selector: string) {
  if (postalCode) {
    if (!/^[a-z0-9][a-z0-9 -]{1,15}$/i.test(postalCode)) throw new Error("postal_code must be a valid postal code");
    await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => undefined);
    await page.locator("#nav-global-location-popover-link").click({ timeout: 10_000, force: true });
    const fields = page.locator("input[id^='GLUXZipUpdateInput']:visible");
    await fields.first().waitFor({ timeout: 15_000 });
    const count = await fields.count();
    if (count === 1) await fields.first().fill(postalCode);
    else {
      const compact = postalCode.replace(/[ -]/g, "");
      let offset = 0;
      for (let index = 0; index < count; index++) {
        const field = fields.nth(index);
        const length = Number(await field.getAttribute("maxlength")) || (index === 0 ? 3 : compact.length - offset);
        await field.fill(compact.slice(offset, offset + length));
        offset += length;
      }
    }
    const button = (await page.locator("#GLUXZipUpdate .a-button-input").count())
      ? page.locator("#GLUXZipUpdate .a-button-input").first()
      : page.locator("#GLUXZipUpdate");
    const [response] = await Promise.all([
      page.waitForResponse(
        (response) =>
          /\/(?:gp\/delivery\/ajax\/address-change\.html|portal-migration\/hz\/glow\/address-change)/.test(response.url()) &&
          response.request().method() === "POST",
        { timeout: 20_000 },
      ),
      button.click({ force: true }),
    ]);
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok() || (body?.isValidAddress !== 1 && body?.isValidAddress !== true))
      throw new Error("Amazon could not apply the requested delivery postal code");
    await navigateAmazon(page, url, selector);
  }
  const displayed = (await page.locator("#glow-ingress-block").count())
    ? await page
        .locator("#glow-ingress-block")
        .innerText({ timeout: 2000 })
        .catch(() => null)
    : null;
  return { postal_code: postalCode, applied: Boolean(postalCode), displayed: displayed?.replace(/\s+/g, " ").trim() || null };
}

function normalizeAmazonPrice(row: Record<string, unknown>, market: AmazonMarketplace) {
  const parsed = amazonMoney(row.price, market);
  row.price_amount = parsed.amount;
  row.price_currency = parsed.currency;
  return row;
}
function offerIdentity(row: Record<string, unknown>): string {
  const value = JSON.stringify([row.seller_id, row.seller_name, row.condition, row.condition_notes, row.price_amount, row.shipping_amount]);
  let hash = 2166136261;
  for (const ch of value) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return `offer-${(hash >>> 0).toString(16)}`;
}
function searchFiltersMatch(row: Record<string, unknown>, input: AmazonInput): boolean {
  const price = row.price_amount == null ? null : Number(row.price_amount);
  if (input.min_price != null && (price == null || price < Number(input.min_price))) return false;
  if (input.max_price != null && (price == null || price > Number(input.max_price))) return false;
  if (input.min_rating != null && (typeof row.rating !== "number" || row.rating < Number(input.min_rating))) return false;
  return true;
}

export async function getAmazonPublic(page: Page, source: AmazonSource, raw: AmazonInput): Promise<PublicApiScraperOutput> {
  const normalized = normalizePrebuiltTaskInput(source, raw, {});
  if (normalized.issues[0]) throw new PublicInputError(normalized.issues[0].instancePath.slice(1), normalized.issues[0].message);
  raw = normalized.input;
  const input: AmazonInput = {
    ...raw,
    query: amazonText(raw.query ?? raw.q),
    category: amazonText(raw.category),
    seller_id: amazonText(raw.seller_id),
    url: amazonText(raw.url),
    asin: amazonText(raw.asin),
    postal_code: amazonText(raw.postal_code),
    brand: amazonText(raw.brand),
  };
  const market = amazonMarketplace(raw.marketplace ?? raw.domain, input.url);
  if (
    source === "amazon-deals" &&
    !input.query &&
    (input.brand || input.category || input.category_id || (input.sort && input.sort !== "relevance"))
  )
    throw new Error("query is required when filtering deals by brand, category or sort");
  const limit = amazonLimit(raw.limit ?? raw.maxResults, source === "amazon-search" ? 100 : raw.include_details ? 10 : 25);
  if (raw.include_details && limit > 10) throw new Error("include_details supports at most 10 variations per request");
  if (input.condition != null && !["all", "new", "used", "renewed"].includes(String(input.condition)))
    throw new Error("condition must be all, new, used or renewed");
  const scope = amazonScope(source, {
    query: input.query,
    category: input.category,
    seller_id: input.seller_id,
    url: input.url,
    asin: input.asin,
    postal_code: input.postal_code,
    brand: input.brand,
    marketplace: market,
    min_price: input.min_price ?? null,
    max_price: input.max_price ?? null,
    min_rating: input.min_rating ?? null,
    sort: input.sort ?? null,
    category_id: input.category_id ?? null,
    condition: input.condition ?? null,
    include_details: input.include_details ?? false,
  });
  const cursor = decodeAmazonCursor(raw.cursor, scope, raw.page);
  const seen = new Set(cursor.seen);
  const origin = amazonOrigin(market);
  let results: Record<string, unknown>[] = [],
    nextCursor: string | null = null,
    data: Record<string, unknown> | null = null;
  let url: string;
  let initialized = false;
  let delivery: { postal_code: string | null; applied: boolean; displayed: string | null } = {
    postal_code: amazonText(input.postal_code),
    applied: false,
    displayed: null,
  };
  await page.addInitScript(() => {
    (globalThis as any).__name ??= (fn: unknown) => fn;
  });
  const load = async (target: string, selector: string) => {
    await navigateAmazon(page, target, selector);
    if (!initialized) {
      delivery = await applyAmazonLocation(page, amazonText(input.postal_code), target, selector);
      initialized = true;
    }
  };
  const product = async (target: string): Promise<Record<string, unknown>> => {
    await load(target, "#productTitle");
    const row: Record<string, unknown> = await page.evaluate(extractAmazonProduct);
    if (!row.title || row.asin !== target.split("/").at(-1)) throw new Error("Amazon did not expose the requested product");
    return { ...normalizeAmazonPrice(row, market), marketplace: market, delivery_location: delivery };
  };
  const pageCursor = (upstreamPage: number) => encodeAmazonCursor({ v: 1, scope, page: upstreamPage, seen: [...seen] });
  if (source === "amazon-products-batch") {
    if (
      !Array.isArray(raw.asins) ||
      raw.asins.length < 1 ||
      raw.asins.length > 10 ||
      !raw.asins.every((asin) => typeof asin === "string" && /^[A-Z0-9]{10}$/i.test(asin))
    )
      throw new Error("asins must contain between 1 and 10 valid Amazon ASINs");
    const asins = [...new Set(raw.asins.map((asin) => String(asin).toUpperCase()))];
    const errors: Record<string, unknown>[] = [];
    for (const asin of asins) {
      try {
        results.push(await product(`${origin}/dp/${asin}`));
      } catch (error) {
        errors.push({ asin, code: "product_unavailable", message: error instanceof Error ? error.message : String(error) });
      }
    }
    if (!results.length)
      throw new Error(`Amazon batch failed for all ${asins.length} products: ${errors.map((e) => e.message).join("; ")}`);
    url = origin;
    data = { requested: asins.length, succeeded: results.length, failed: errors.length, errors };
  } else if (["amazon-asin", "amazon-price", "amazon-product-variations"].includes(source)) {
    url = amazonProductUrl({ ...input, marketplace: market });
    const selected = await product(url);
    if (source === "amazon-product-variations") {
      const variations = await page.evaluate(extractAmazonVariations);
      const available = variations.rows.filter((row) => !seen.has(row.asin));
      const rows = available.slice(0, limit);
      const errors: Record<string, unknown>[] = [];
      for (const row of rows) {
        let detail = row.is_selected ? selected : null;
        if (raw.include_details && !detail) {
          try {
            detail = await product(row.url);
          } catch (error) {
            errors.push({ asin: row.asin, message: error instanceof Error ? error.message : String(error) });
          }
        }
        results.push({
          ...row,
          title: detail?.title ?? null,
          price: detail?.price ?? null,
          price_amount: detail?.price_amount ?? null,
          price_currency: detail?.price_currency ?? null,
          availability: detail?.availability ?? null,
          image_url: detail?.image_url ?? null,
        });
        seen.add(row.asin);
      }
      if (available.length > rows.length) nextCursor = pageCursor(1);
      data = {
        parent_asin: variations.parent_asin,
        dimensions: variations.dimensions,
        has_variations: variations.has_variations,
        total_variations: variations.rows.length,
        errors,
      };
    } else {
      results = [selected];
      data = selected;
    }
  } else {
    const isOffers = source === "amazon-product-offers";
    const isRanking = ["amazon-best-sellers", "amazon-movers-and-shakers", "amazon-new-releases"].includes(source);
    const isDeals = source === "amazon-deals";
    if (source === "amazon-search" && !input.query) throw new Error("Amazon search requires query");
    if (source === "amazon-seller-products" && !input.seller_id) throw new Error("Amazon seller products requires seller_id");
    const productUrl = isOffers ? amazonProductUrl({ ...input, marketplace: market }) : null;
    const rankingKind =
      source === "amazon-best-sellers" ? "best-sellers" : source === "amazon-movers-and-shakers" ? "movers-and-shakers" : "new-releases";
    const base = isOffers
      ? `${origin}/gp/product/ajax/aodAjaxMain?asin=${productUrl!.split("/").at(-1)}&pc=dp`
      : isRanking
        ? amazonBestSellersUrl(amazonText(input.category), market, rankingKind)
        : isDeals && !input.query
          ? `${origin}/deals`
          : amazonSearchUrl(input, market);
    url = isOffers ? productUrl! : base;
    if (isOffers) {
      await load(productUrl!, "#productTitle");
    }
    let upstream = cursor.page;
    const maxPages = source === "amazon-search" ? Math.min(10, Math.max(3, Math.ceil(limit / 12) + 1)) : 3;
    for (let scan = 0; scan < maxPages && results.length < limit; scan++, upstream++) {
      const target = new URL(base);
      if (upstream > 1) target.searchParams.set(isOffers ? "pageno" : isRanking ? "pg" : "page", String(upstream));
      const selector = isOffers
        ? "#aod-offer, #aod-pinned-offer"
        : isRanking
          ? ".zg-grid-general-faceout, .zg-carousel-general-faceout, #zg-ordered-list [data-asin]"
          : isDeals && !input.query
            ? ".dcl-product, [data-testid='product-card'], [data-testid='deal-card']"
            : "[data-component-type='s-search-result'], .s-no-results";
      await load(target.toString(), selector);
      let rows: Record<string, unknown>[], hasNext: boolean;
      if (isOffers) {
        const offers = await page.evaluate(extractAmazonOffers);
        if (!offers.rows.length && !offers.empty) throw new Error("Amazon did not expose offer data");
        rows = offers.rows
          .map((row): Record<string, unknown> => {
            normalizeAmazonPrice(row, market);
            const shipping = amazonMoney(row.shipping_price, market);
            const total =
              row.price_amount != null && shipping.amount != null
                ? (Number(row.price_amount) + Number(shipping.amount)).toFixed(market === "amazon.co.jp" ? 0 : 2)
                : null;
            return {
              ...row,
              asin: productUrl!.split("/").at(-1),
              shipping_amount: shipping.amount,
              total_amount: total,
              marketplace: market,
            };
          })
          .filter(
            (row) =>
              input.condition == null ||
              input.condition === "all" ||
              (input.condition === "new" && /^new\b|^neu\b|^neuf\b|^nuovo\b|^nuevo\b|新品/i.test(String(row.condition))) ||
              (input.condition === "used" && /used|gebraucht|occasion|usato|usado|中古/i.test(String(row.condition))) ||
              (input.condition === "renewed" && /renew|refurb|recondition|整備済/i.test(String(row.condition))),
          );
        rows = rows.map((row) => ({ ...row, id: offerIdentity(row) }));
        hasNext = offers.total != null ? upstream * 10 < offers.total : offers.rows.filter((row) => !row.is_featured_offer).length >= 10;
        data = { asin: productUrl!.split("/").at(-1), total_offers: offers.total };
      } else {
        rows = await page.evaluate(
          extractAmazonCards,
          isRanking
            ? ("best-sellers" as const)
            : isDeals
              ? input.query
                ? ("search-deals" as const)
                : ("deals" as const)
              : ("search" as const),
        );
        rows = rows
          .map((row) => normalizeAmazonPrice(row, market))
          .filter((row) => searchFiltersMatch(row, input) && (input.sort == null || input.sort === "relevance" || !row.is_sponsored));
        const next = await page.evaluate(() => document.querySelector<HTMLAnchorElement>("a.s-pagination-next, li.a-last a")?.href || null);
        hasNext = Boolean(next && new URL(next).origin === origin);
        if (isDeals && !input.query) hasNext = false;
        if (isRanking) {
          const final = new URL(page.url()).pathname;
          const requestedDepartment = new URL(base).pathname.split(
            isRanking && rankingKind === "best-sellers" ? "/zgbs/" : `/gp/${rankingKind}/`,
          )[1];
          if (requestedDepartment && !final.replace(/\/$/, "").endsWith(`/${requestedDepartment}`))
            throw new Error("Amazon redirected away from the requested category");
          if (!rows.length) data = { notice: "Amazon currently exposes no entries for this category." };
        }
      }
      const onPage = new Set<string>();
      const fresh = rows.filter((row) => {
        const id = String(row.id);
        if (seen.has(id) || onPage.has(id)) return false;
        onPage.add(id);
        return true;
      });
      const selected = fresh.slice(0, limit - results.length);
      results.push(...selected);
      selected.forEach((row) => seen.add(String(row.id)));
      if (selected.length < fresh.length) {
        nextCursor = pageCursor(upstream);
        break;
      }
      if (!hasNext) {
        nextCursor = null;
        break;
      }
      nextCursor = pageCursor(upstream + 1);
    }
  }
  const metadata = { marketplace: market, delivery_location: delivery };
  data = { ...data, ...metadata };
  return {
    success: true,
    source,
    query: amazonText(input.query),
    url,
    results,
    count: results.length,
    data,
    max_results_requested:
      source === "amazon-products-batch"
        ? Array.isArray(raw.asins)
          ? new Set(raw.asins.map((a) => String(a).toUpperCase())).size
          : limit
        : limit,
    pagination: {
      cursor: amazonText(raw.cursor),
      next_cursor: nextCursor,
      has_next_page: Boolean(nextCursor),
      count: results.length,
      strategy: ["amazon-asin", "amazon-price", "amazon-products-batch"].includes(source) ? "none" : "cursor",
    },
  };
}
