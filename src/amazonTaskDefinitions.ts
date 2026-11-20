import { AMAZON_MARKETPLACES, AMAZON_SORTS } from "./amazonCommon.js";
const str = { type: "string" };
const ns = { type: ["string", "null"] };
const nn = { type: ["number", "null"] };
const integer = { type: "integer", minimum: 0 };
const obj = (properties: Record<string, unknown>, required = Object.keys(properties), additionalProperties: unknown = false) => ({
  type: "object",
  properties,
  required,
  additionalProperties,
});
const delivery = obj({ postal_code: ns, applied: { type: "boolean" }, displayed: ns });
const metadata = { marketplace: { type: "string", enum: Object.keys(AMAZON_MARKETPLACES) }, delivery_location: delivery };
const price = {
  price: ns,
  price_amount: { ...ns, description: "Decimal amount in the displayed currency, without grouping separators; null when unavailable." },
  price_currency: ns,
};
const product = obj({
  id: str,
  asin: str,
  url: str,
  title: str,
  description: ns,
  ...price,
  availability: ns,
  availability_text: ns,
  rating: nn,
  review_count: { type: ["integer", "null"] },
  image_url: ns,
  image_urls: { type: "array", items: str },
  details: { type: "object", additionalProperties: str },
  ...metadata,
});
const card = obj({
  id: str,
  asin: str,
  title: str,
  url: str,
  ...price,
  list_price: ns,
  rating: nn,
  image_url: ns,
  deal_badge: ns,
  rank: { type: ["integer", "null"] },
  sales_rank: { type: ["integer", "null"] },
  previous_sales_rank: { type: ["integer", "null"] },
  rank_change_percent: nn,
  is_sponsored: { type: "boolean" },
  name: str,
  link: str,
  images: { type: "array", items: str },
  tags: { type: "array", items: str },
  numberOfReviews: { type: ["integer", "null"] },
});
const offer = obj({
  id: str,
  asin: str,
  seller_id: ns,
  seller_name: ns,
  seller_url: ns,
  ships_from: ns,
  condition: ns,
  condition_notes: ns,
  ...price,
  shipping_price: ns,
  shipping_amount: ns,
  shipping_text: ns,
  total_amount: ns,
  is_featured_offer: { type: "boolean" },
  seller_rating_text: ns,
  marketplace: metadata.marketplace,
});
const variation = obj({
  id: str,
  asin: str,
  url: str,
  parent_asin: ns,
  attributes: { type: "object", additionalProperties: str },
  is_selected: { type: "boolean" },
  title: ns,
  ...price,
  availability: ns,
  image_url: ns,
});
const pagination = obj({
  cursor: ns,
  next_cursor: ns,
  has_next_page: { type: "boolean" },
  count: integer,
  strategy: { type: "string", enum: ["none", "cursor"] },
});
function output(source: string, item: unknown, data: unknown) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...obj({
      success: { const: true },
      source: { const: source },
      query: ns,
      url: ns,
      results: { type: "array", items: item },
      count: integer,
      data,
      max_results_requested: { type: "integer", minimum: 1 },
      pagination,
    }),
  };
}
const context = {
  marketplace: {
    type: "string",
    enum: Object.keys(AMAZON_MARKETPLACES),
    description: "Amazon marketplace. Defaults to the product URL's marketplace, or amazon.com.",
    "x-sample": "amazon.com",
  },
  postal_code: {
    type: "string",
    minLength: 2,
    maxLength: 16,
    pattern: "^[a-zA-Z0-9][a-zA-Z0-9 -]+$",
    description: "Delivery postal code. The request fails if Amazon cannot apply it; responses include the displayed delivery location.",
    "x-sample": "10001",
  },
};
const page = {
  limit: { type: "integer", minimum: 1, maximum: 100, default: 25, description: "Maximum results in this response." },
  cursor: { type: "string", maxLength: 131072, description: "next_cursor from a prior response using the same filters and marketplace." },
  page: {
    type: "integer",
    minimum: 1,
    maximum: 1000,
    description: "Starting upstream page. Prefer cursor to retain unused results and avoid duplicates.",
  },
};
const asin = { type: "string", pattern: "^[a-zA-Z0-9]{10}$", "x-sample": "B0C3HCD34R", description: "Amazon product ASIN." };
const url = {
  type: "string",
  format: "uri",
  pattern: "^https://",
  description: "Product URL on a supported Amazon marketplace.",
  "x-sample": "https://www.amazon.com/dp/B0C3HCD34R",
};
const single = { ...context, asin, url };
const singleInput = (extra: Record<string, unknown> = {}) => ({
  ...obj({ ...single, ...extra }, []),
  anyOf: [{ required: ["asin"] }, { required: ["url"] }],
});
const query = { type: "string", minLength: 1, maxLength: 500, "x-sample": "wireless headphones" };
const category = {
  type: "string",
  minLength: 1,
  maxLength: 100,
  description: "Department such as electronics, kitchen, books, beauty or pet supplies. Unsupported departments fail explicitly.",
  "x-sample": "electronics",
};
const filters = {
  category,
  category_id: { type: "string", pattern: "^[0-9]{1,20}$", description: "Amazon browse node ID for a more specific category." },
  min_price: { type: "number", minimum: 0, description: "Minimum item price in the marketplace currency." },
  max_price: { type: "number", minimum: 0, description: "Maximum item price in the marketplace currency." },
  min_rating: { type: "integer", enum: [1, 2, 3, 4], description: "Minimum product star rating." },
  brand: { type: "string", minLength: 1, maxLength: 100, pattern: "^[^:,]+$", description: "Single brand name." },
  sort: { type: "string", enum: Object.keys(AMAZON_SORTS), default: "relevance" },
};
const listData = obj({ ...metadata, notice: str }, Object.keys(metadata));
const publicNote =
  " No Amazon sign-in required. Prices and availability reflect the marketplace and delivery location; unavailable fields are null.";
export const amazonTaskDefinitions = [
  {
    name: "Amazon Search API",
    path: "amazon/search",
    builtin: "amazon-search",
    description: "Search Amazon products with price, rating, brand and category filters, sorting, and continuation cursors." + publicNote,
    inputSchema: obj(
      {
        query,
        ...context,
        ...filters,
        ...page,
        limit: { ...page.limit, default: 100 },
        domain: { ...context.marketplace, description: "Compatibility alias for marketplace." },
        maxResults: { type: "integer", minimum: 1, maximum: 100, description: "Compatibility alias for limit." },
      },
      ["query"],
    ),
    outputSchema: output("amazon-search", card, listData),
  },
  {
    name: "Amazon ASIN Lookup API",
    path: "amazon/asin",
    builtin: "amazon-asin",
    description: "Fetch product details, specifications, images, price and availability by ASIN or URL." + publicNote,
    inputSchema: singleInput(),
    outputSchema: output("amazon-asin", product, product),
  },
  {
    name: "Amazon Product Price API",
    path: "amazon/price",
    builtin: "amazon-price",
    description: "Fetch the current product price and availability by ASIN or URL." + publicNote,
    inputSchema: singleInput(),
    outputSchema: output("amazon-price", product, product),
  },
  ...(
    [
      ["best-sellers", "Best Sellers", "best-sellers"],
      ["new-releases", "New Releases", "new-releases"],
    ] as const
  ).map(([path, title, builtin]) => ({
    name: `Amazon ${title} API`,
    path: `amazon/${path}`,
    builtin: `amazon-${builtin}`,
    description:
      `Fetch Amazon ${title} by category with continuation cursors. Empty lists are returned when Amazon explicitly reports no entries.` +
      publicNote,
    inputSchema: obj({ ...context, category, ...page }, []),
    outputSchema: output(`amazon-${builtin}`, card, listData),
  })),
  {
    name: "Amazon Deals API",
    path: "amazon/deals",
    builtin: "amazon-deals",
    description:
      "Fetch public deals, or search for products with active deal badges. Query pages can be empty after filtering; continue while next_cursor is present." +
      publicNote,
    inputSchema: obj({ ...context, query, ...filters, ...page }, []),
    outputSchema: output("amazon-deals", card, listData),
  },
  {
    name: "Amazon Product Offers API",
    path: "amazon/product/offers",
    builtin: "amazon-product-offers",
    description:
      "Compare public seller offers, item condition, shipping and Featured Offer status for a product. Total prices are null when shipping cannot be determined." +
      publicNote,
    inputSchema: singleInput({ ...page, condition: { type: "string", enum: ["all", "new", "used", "renewed"], default: "all" } }),
    outputSchema: output("amazon-product-offers", offer, obj({ ...metadata, asin: str, total_offers: { type: ["integer", "null"] } })),
  },
  {
    name: "Amazon Product Variations API",
    path: "amazon/product/variations",
    builtin: "amazon-product-variations",
    description:
      "List related child ASINs and their size, colour and style attributes. Set include_details to fetch each variant's current price and availability (maximum 10 per request). Without it, only the selected variant has product details." +
      publicNote,
    inputSchema: {
      ...singleInput({ ...page, include_details: { type: "boolean", default: false } }),
      allOf: [
        {
          anyOf: [
            { properties: { include_details: { const: false } } },
            { properties: { include_details: { const: true }, limit: { maximum: 10 } }, required: ["include_details"] },
          ],
        },
      ],
    },
    outputSchema: output(
      "amazon-product-variations",
      variation,
      obj({
        ...metadata,
        parent_asin: ns,
        dimensions: { type: "array", items: str },
        has_variations: { type: "boolean" },
        total_variations: integer,
        errors: { type: "array", items: obj({ asin: str, message: str }) },
      }),
    ),
  },
  {
    name: "Amazon Products Batch API",
    path: "amazon/products/batch",
    builtin: "amazon-products-batch",
    description:
      "Fetch up to 10 products by ASIN. Duplicate ASINs are fetched once. Partial batches include per-product errors; all-failed batches fail." +
      publicNote,
    inputSchema: obj(
      { ...context, asins: { type: "array", minItems: 1, maxItems: 10, items: asin, "x-sample": ["B0C3HCD34R", "B085DV8T75"] } },
      ["asins"],
    ),
    outputSchema: output(
      "amazon-products-batch",
      product,
      obj({
        ...metadata,
        requested: integer,
        succeeded: integer,
        failed: integer,
        errors: { type: "array", items: obj({ asin: str, code: str, message: str }) },
      }),
    ),
  },
  {
    name: "Amazon Seller Products API",
    path: "amazon/seller/products",
    builtin: "amazon-seller-products",
    description:
      "Browse a public seller's product catalogue by merchant ID, with optional search, filters, sorting and continuation cursors." +
      publicNote,
    inputSchema: obj(
      {
        ...context,
        seller_url: { type: "string", format: "uri", description: "HTTPS Amazon seller URL containing seller= or me=." },
        seller_id: {
          type: "string",
          pattern: "^[A-Z0-9]{8,32}$",
          "x-sample": "A294P4X9EWVXLJ",
          description: "Merchant ID from a public Amazon seller URL or product offer.",
        },
        query,
        ...filters,
        ...page,
      },
      ["seller_id"],
    ),
    outputSchema: output("amazon-seller-products", card, listData),
  },
];
