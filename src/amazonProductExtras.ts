// These extractors run inside the browser. Do not capture module-scoped helpers.
export function extractAmazonOffers() {
  const text = (n: Element | null) => n?.textContent?.replace(/\s+/g, " ").trim() || null;
  const rows: Record<string, unknown>[] = [];
  for (const offer of document.querySelectorAll("#aod-pinned-offer, #aod-offer")) {
    const priceNode = offer.querySelector(
      "#aod-offer-price .a-price:not(.a-text-price), #pinned-offer-top-id .a-price:not(.a-text-price), .a-price:not(.a-text-price)",
    );
    const accessible = text(priceNode?.querySelector(".a-offscreen") ?? null);
    const whole = text(priceNode?.querySelector(".a-price-whole") ?? null)?.replace(/[.,]$/, "");
    const fraction = text(priceNode?.querySelector(".a-price-fraction") ?? null);
    const symbol = text(priceNode?.querySelector(".a-price-symbol") ?? null) || "";
    const decimal = /amazon\.(?:de|fr|it|es)$/.test(location.hostname) ? "," : ".";
    const price = accessible || (whole ? `${symbol}${whole}${fraction ? decimal + fraction : ""}` : null);
    const soldBy = offer.querySelector("#aod-offer-soldBy .a-col-right");
    const sellerLink = soldBy?.querySelector<HTMLAnchorElement>("a[href*='seller='], a[href*='me=']");
    const sellerName =
      text(sellerLink ?? soldBy ?? null)
        ?.split(/\(\d|Seller rating|\d+%/)[0]
        ?.trim() || null;
    let sellerId: string | null = null;
    if (sellerLink) {
      const params = new URL(sellerLink.href).searchParams;
      sellerId = params.get("seller") || params.get("me");
    }
    const shippingNode = offer.querySelector("[data-csa-c-delivery-price]");
    const shippingPrice = shippingNode?.getAttribute("data-csa-c-delivery-price") || null;
    const shippingText = text(offer.querySelector("#aod-delivery-promise, [id*='delivery-promise'], #aod-offer-deliveryInfo"));
    const conditional = /orders over|orders of|prime members|eligible orders|with prime/i.test(shippingText || "");
    const shippingFree = !conditional && /^(?:FREE|GRATIS|GRATUIT|KOSTENLOS)$/i.test(shippingPrice || "");
    rows.push({
      seller_id: sellerId,
      seller_name: sellerName,
      seller_url: sellerLink ? new URL(`/sp?seller=${encodeURIComponent(sellerId || "")}`, location.origin).toString() : null,
      ships_from: text(offer.querySelector("#aod-offer-shipsFrom .a-col-right")),
      condition: text(offer.querySelector("#aod-offer-heading")),
      condition_notes: text(offer.querySelector("#aod-offer-condition")),
      price,
      shipping_price: shippingFree ? "0" : shippingPrice && /\d/.test(shippingPrice) && !conditional ? shippingPrice : null,
      shipping_text: shippingText,
      is_featured_offer: offer.id === "aod-pinned-offer",
      seller_rating_text: text(offer.querySelector("#aod-offer-seller-rating")),
    });
  }
  const totalInput = document.querySelector<HTMLInputElement>("#aod-total-offer-count");
  const total = Number.parseInt(
    totalInput?.value || text(totalInput) || text(document.querySelector("#aod-filter-offer-count-string"))?.match(/\d+/)?.[0] || "",
    10,
  );
  return {
    rows,
    total: Number.isFinite(total) ? total : null,
    empty: /no offers|no sellers|currently unavailable/i.test(document.body?.innerText || ""),
  };
}

export function extractAmazonVariations() {
  // Extract JSON values by balanced delimiters. Never execute a page script as code.
  const value = (source: string, key: string): any => {
    const match = new RegExp(`"${key}"\\s*:\\s*`).exec(source);
    if (!match) return null;
    const start = match.index + match[0].length;
    const first = source[start];
    let quoted = false,
      escaped = false,
      depth = 0;
    for (let i = start; i < source.length; i++) {
      const ch = source[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (quoted && ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        quoted = !quoted;
        if (!quoted && first === '"') {
          try {
            return JSON.parse(source.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
      if (quoted) continue;
      if (ch === "{" || ch === "[") depth++;
      if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(source.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  };
  const script =
    Array.from(document.querySelectorAll("script"))
      .map((n) => n.textContent || "")
      .find((s) => /"(?:dimensionValuesDisplayData|asinVariationValues|dimensionToAsinMap)"\s*:/.test(s)) || "";
  const variationValues = value(script, "variationValues") || {};
  const dimensions: string[] = value(script, "dimensions") || Object.keys(variationValues);
  const mapping: Record<string, unknown[]> = value(script, "dimensionValuesDisplayData") || {};
  if (!Object.keys(mapping).length) {
    for (const [asin, attributes] of Object.entries(value(script, "asinVariationValues") || {})) {
      if (!attributes || typeof attributes !== "object") continue;
      mapping[asin] = dimensions.map((dimension) => {
        const raw = (attributes as Record<string, unknown>)[dimension];
        return variationValues[dimension]?.[Number(raw)] ?? raw ?? "";
      });
    }
  }
  if (!Object.keys(mapping).length) {
    for (const [combination, asin] of Object.entries(value(script, "dimensionToAsinMap") || {})) {
      if (typeof asin !== "string" || !/^\d+(?:_\d+)*$/.test(combination)) continue;
      const indices = combination.split("_").map(Number);
      mapping[asin] = dimensions.map((dimension, i) => variationValues[dimension]?.[indices[i]!] ?? "");
    }
  }
  const currentAsin =
    document.querySelector<HTMLInputElement>("#ASIN")?.value ||
    value(script, "currentAsin") ||
    location.pathname.match(/\/dp\/([a-z0-9]{10})/i)?.[1];
  const selectedAttributes: Record<string, string> = {};
  for (const [key, val] of Object.entries(value(script, "selectedVariationValues") || {})) {
    const selected = value(script, "variationValues")?.[key]?.[Number(val)];
    if (typeof selected === "string") selectedAttributes[key] = selected;
  }
  const rows = Object.entries(mapping)
    .filter(([asin, values]) => /^[A-Z0-9]{10}$/i.test(asin) && Array.isArray(values))
    .map(([asin, values]) => ({
      id: asin,
      asin,
      url: `${location.origin}/dp/${asin}`,
      parent_asin: value(script, "parentAsin"),
      attributes: Object.fromEntries(dimensions.map((dimension, i) => [dimension, String((values as unknown[])[i] ?? "")])),
      is_selected: asin === currentAsin,
    }));
  if (!rows.length && currentAsin)
    rows.push({
      id: currentAsin,
      asin: currentAsin,
      url: `${location.origin}/dp/${currentAsin}`,
      parent_asin: value(script, "parentAsin"),
      attributes: selectedAttributes,
      is_selected: true,
    });
  return { rows, parent_asin: value(script, "parentAsin"), dimensions, has_variations: rows.length > 1 };
}
