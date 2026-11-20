import type { PublicApiScraperInput } from "./public-api-types.js";

export const AMAZON_MARKETPLACES = {
  "amazon.com": { currency: "USD", decimal: ".", country: "US" },
  "amazon.co.uk": { currency: "GBP", decimal: ".", country: "GB" },
  "amazon.ca": { currency: "CAD", decimal: ".", country: "CA" },
  "amazon.de": { currency: "EUR", decimal: ",", country: "DE" },
  "amazon.fr": { currency: "EUR", decimal: ",", country: "FR" },
  "amazon.it": { currency: "EUR", decimal: ",", country: "IT" },
  "amazon.es": { currency: "EUR", decimal: ",", country: "ES" },
  "amazon.co.jp": { currency: "JPY", decimal: ".", country: "JP" },
  "amazon.in": { currency: "INR", decimal: ".", country: "IN" },
  "amazon.com.au": { currency: "AUD", decimal: ".", country: "AU" },
} as const;
export type AmazonMarketplace = keyof typeof AMAZON_MARKETPLACES;
const aliases: Record<string, AmazonMarketplace> = {
  us: "amazon.com",
  uk: "amazon.co.uk",
  gb: "amazon.co.uk",
  ca: "amazon.ca",
  de: "amazon.de",
  fr: "amazon.fr",
  it: "amazon.it",
  es: "amazon.es",
  jp: "amazon.co.jp",
  in: "amazon.in",
  au: "amazon.com.au",
};
export function amazonMarketplace(value: unknown, url?: unknown): AmazonMarketplace {
  let domain =
    typeof value === "string" && value.trim()
      ? value
          .trim()
          .toLowerCase()
          .replace(/^www\./, "")
      : null;
  if (domain && aliases[domain]) domain = aliases[domain]!;
  let urlDomain: string | null = null;
  if (typeof url === "string" && url) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) throw new Error("Expected an HTTPS Amazon URL");
    urlDomain = parsed.hostname.replace(/^www\./, "");
    if (!(urlDomain in AMAZON_MARKETPLACES)) throw new Error("Unsupported Amazon product URL host");
  }
  if (domain && urlDomain && domain !== urlDomain) throw new Error("Amazon URL and marketplace must match");
  domain ??= urlDomain ?? "amazon.com";
  if (!Object.hasOwn(AMAZON_MARKETPLACES, domain)) throw new Error(`Unsupported Amazon marketplace: ${domain}`);
  return domain as AmazonMarketplace;
}
export function amazonOrigin(market: AmazonMarketplace) {
  return `https://www.${market}`;
}
export function amazonMoney(value: unknown, market: AmazonMarketplace): { amount: string | null; currency: string | null } {
  if (typeof value !== "string") return { amount: null, currency: null };
  const currency = value.match(/(?<![a-z])(USD|GBP|CAD|EUR|JPY|INR|AUD|THB|CNY|SGD|HKD|AED|SAR|SEK|PLN|BRL|MXN|TRY)(?![a-z])/i)?.[1]?.toUpperCase()
    ?? (/US\$/.test(value) ? "USD" : /(?:CA|CDN)\$/.test(value) ? "CAD" : /A(?:U)?\$/.test(value) ? "AUD" : /£/.test(value) ? "GBP" : /€/.test(value) ? "EUR" : /₹/.test(value) ? "INR" : /฿/.test(value) ? "THB" : AMAZON_MARKETPLACES[market].currency);
  const match = value.replace(/[\s\u00a0\u202f]/g, "").match(/\d[\d.,]*/);
  if (!match) return { amount: null, currency: null };
  const raw = match[0].replace(/[.,]$/, "");
  const last = Math.max(raw.lastIndexOf("."), raw.lastIndexOf(","));
  const decimalDigits = last >= 0 ? raw.length - last - 1 : 0;
  const normalized =
    last >= 0 && decimalDigits >= 1 && decimalDigits <= 2
      ? raw.slice(0, last).replace(/[.,]/g, "") + "." + raw.slice(last + 1)
      : raw.replace(/[.,]/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0
    ? { amount: number.toFixed(currency === "JPY" ? 0 : 2), currency }
    : { amount: null, currency: null };
}
export const AMAZON_SORTS = {
  relevance: "relevanceblender",
  price_asc: "price-asc-rank",
  price_desc: "price-desc-rank",
  rating: "review-rank",
  newest: "date-desc-rank",
} as const;
export type AmazonInput = PublicApiScraperInput & { maxResults?: unknown };
export function amazonText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
export function amazonLimit(value: unknown, fallback = 25, max = 100): number {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > max)
    throw new Error(`limit must be an integer between 1 and ${max}`);
  return Number(value);
}
export type AmazonCursor = { v: 1; scope: string; page: number; seen: string[] };
export function amazonScope(source: string, input: Record<string, unknown>): string {
  // Bind cursors to semantic inputs; limit/page/cursor can change independently.
  return JSON.stringify([
    source,
    Object.entries(input)
      .filter(([k]) => !["limit", "page", "cursor", "maxResults"].includes(k))
      .sort(([a], [b]) => a.localeCompare(b)),
  ]);
}
export function decodeAmazonCursor(value: unknown, scope: string, page: unknown): AmazonCursor {
  if (value != null) {
    try {
      if (typeof value !== "string" || value.length > 131072) throw new Error();
      const decoded = JSON.parse(
        new TextDecoder().decode(Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))),
      );
      if (
        decoded.v !== 1 ||
        decoded.scope !== scope ||
        !Number.isInteger(decoded.page) ||
        decoded.page < 1 ||
        decoded.page > 1000 ||
        !Array.isArray(decoded.seen) ||
        decoded.seen.length > 4096 ||
        !decoded.seen.every((v: unknown) => typeof v === "string" && v.length <= 180)
      )
        throw new Error();
      return decoded;
    } catch {
      throw new Error("Invalid Amazon cursor or cursor does not match the request filters");
    }
  }
  if (page != null && (!Number.isInteger(page) || Number(page) < 1 || Number(page) > 1000))
    throw new Error("page must be an integer between 1 and 1000");
  return { v: 1, scope, page: Number(page ?? 1), seen: [] };
}
export function encodeAmazonCursor(cursor: AmazonCursor): string {
  if (cursor.seen.length > 4096) throw new Error("Amazon pagination reached its 4096-result session limit; start a new search");
  return btoa(Array.from(new TextEncoder().encode(JSON.stringify(cursor)), (b) => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Temporary upstream responses and interrupted browser contexts allow a fresh anonymous read. */
export class AmazonTemporaryError extends Error {
  override readonly name = "AmazonTemporaryError";
}
export function isRetryableAmazonPublicError(error: unknown): boolean {
  return (
    error instanceof AmazonTemporaryError ||
    (error instanceof Error &&
      /^page\.(?:evaluate|waitForFunction): Execution context was destroyed, most likely because of a navigation/.test(error.message))
  );
}
