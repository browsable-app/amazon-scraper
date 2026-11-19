# Endpoint reference

Call these operations through the CLI or `scrape(endpoint, input)`. JSON field names use underscores; CLI flags use hyphens. Omitted fields use the documented defaults.

## amazon/search

Search Amazon products with price, rating, brand and category filters, sorting, and continuation cursors. No Amazon sign-in required. Prices and availability reflect the marketplace and delivery location; unavailable fields are null.

| Input | Type | Required | Details |
| --- | --- | --- | --- |
| `query` | string | Yes |  |
| `marketplace` | string | No | Amazon marketplace. Defaults to the product URL's marketplace, or amazon.com. Values: amazon.com, amazon.co.uk, amazon.ca, amazon.de, amazon.fr, amazon.it, amazon.es, amazon.co.jp, amazon.in, amazon.com.au. |
| `postal_code` | string | No | Delivery postal code. The request fails if Amazon cannot apply it; responses include the displayed delivery location. |
| `category` | string | No | Department such as electronics, kitchen, books, beauty or pet supplies. Unsupported departments fail explicitly. |
| `category_id` | string | No | Amazon browse node ID for a more specific category. |
| `min_price` | number | No | Minimum item price in the marketplace currency. Minimum: 0. |
| `max_price` | number | No | Maximum item price in the marketplace currency. Minimum: 0. |
| `min_rating` | integer | No | Minimum product star rating. Values: 1, 2, 3, 4. |
| `brand` | string | No | Single brand name. |
| `sort` | string | No | Values: relevance, price_asc, price_desc, rating, newest. Default: relevance. |
| `limit` | integer | No | Maximum results in this response. Default: 100. Minimum: 1. Maximum: 100. |
| `cursor` | string | No | next_cursor from a prior response using the same filters and marketplace. |
| `page` | integer | No | Starting upstream page. Prefer cursor to retain unused results and avoid duplicates. Minimum: 1. Maximum: 1000. |
| `domain` | string | No | Compatibility alias for marketplace. Values: amazon.com, amazon.co.uk, amazon.ca, amazon.de, amazon.fr, amazon.it, amazon.es, amazon.co.jp, amazon.in, amazon.com.au. |
| `maxResults` | integer | No | Compatibility alias for limit. Minimum: 1. Maximum: 100. |

## amazon/asin

Fetch product details, specifications, images, price and availability by ASIN or URL. No Amazon sign-in required. Prices and availability reflect the marketplace and delivery location; unavailable fields are null.

| Input | Type | Required | Details |
| --- | --- | --- | --- |
| `marketplace` | string | No | Amazon marketplace. Defaults to the product URL's marketplace, or amazon.com. Values: amazon.com, amazon.co.uk, amazon.ca, amazon.de, amazon.fr, amazon.it, amazon.es, amazon.co.jp, amazon.in, amazon.com.au. |
| `postal_code` | string | No | Delivery postal code. The request fails if Amazon cannot apply it; responses include the displayed delivery location. |
| `asin` | string | No | Amazon product ASIN. |
| `url` | string | No | Product URL on a supported Amazon marketplace. |

Supply `asin` or `url`. When both are supplied, they must identify the same product.

## amazon/price

Fetch the current product price and availability by ASIN or URL. No Amazon sign-in required. Prices and availability reflect the marketplace and delivery location; unavailable fields are null.

| Input | Type | Required | Details |
| --- | --- | --- | --- |
| `marketplace` | string | No | Amazon marketplace. Defaults to the product URL's marketplace, or amazon.com. Values: amazon.com, amazon.co.uk, amazon.ca, amazon.de, amazon.fr, amazon.it, amazon.es, amazon.co.jp, amazon.in, amazon.com.au. |
| `postal_code` | string | No | Delivery postal code. The request fails if Amazon cannot apply it; responses include the displayed delivery location. |
| `asin` | string | No | Amazon product ASIN. |
| `url` | string | No | Product URL on a supported Amazon marketplace. |

Supply `asin` or `url`. When both are supplied, they must identify the same product.

## amazon/best-sellers

Fetch Amazon Best Sellers by category with continuation cursors. Empty lists are returned when Amazon explicitly reports no entries. No Amazon sign-in required. Prices and availability reflect the marketplace and delivery location; unavailable fields are null.

| Input | Type | Required | Details |
| --- | --- | --- | --- |
| `marketplace` | string | No | Amazon marketplace. Defaults to the product URL's marketplace, or amazon.com. Values: amazon.com, amazon.co.uk, amazon.ca, amazon.de, amazon.fr, amazon.it, amazon.es, amazon.co.jp, amazon.in, amazon.com.au. |
| `postal_code` | string | No | Delivery postal code. The request fails if Amazon cannot apply it; responses include the displayed delivery location. |
| `category` | string | No | Department such as electronics, kitchen, books, beauty or pet supplies. Unsupported departments fail explicitly. |
| `limit` | integer | No | Maximum results in this response. Default: 25. Minimum: 1. Maximum: 100. |
| `cursor` | string | No | next_cursor from a prior response using the same filters and marketplace. |
| `page` | integer | No | Starting upstream page. Prefer cursor to retain unused results and avoid duplicates. Minimum: 1. Maximum: 1000. |

## amazon/movers-and-shakers

Fetch Amazon Movers and Shakers by category with continuation cursors. Empty lists are returned when Amazon explicitly reports no entries. No Amazon sign-in required. Prices and availability reflect the marketplace and delivery location; unavailable fields are null.

| Input | Type | Required | Details |
| --- | --- | --- | --- |
| `marketplace` | string | No | Amazon marketplace. Defaults to the product URL's marketplace, or amazon.com. Values: amazon.com, amazon.co.uk, amazon.ca, amazon.de, amazon.fr, amazon.it, amazon.es, amazon.co.jp, amazon.in, amazon.com.au. |
| `postal_code` | string | No | Delivery postal code. The request fails if Amazon cannot apply it; responses include the displayed delivery location. |
| `category` | string | No | Department such as electronics, kitchen, books, beauty or pet supplies. Unsupported departments fail explicitly. |
| `limit` | integer | No | Maximum results in this response. Default: 25. Minimum: 1. Maximum: 100. |
| `cursor` | string | No | next_cursor from a prior response using the same filters and marketplace. |
| `page` | integer | No | Starting upstream page. Prefer cursor to retain unused results and avoid duplicates. Minimum: 1. Maximum: 1000. |

## amazon/new-releases

Fetch Amazon New Releases by category with continuation cursors. Empty lists are returned when Amazon explicitly reports no entries. No Amazon sign-in required. Prices and availability reflect the marketplace and delivery location; unavailable fields are null.

| Input | Type | Required | Details |
| --- | --- | --- | --- |
| `marketplace` | string | No | Amazon marketplace. Defaults to the product URL's marketplace, or amazon.com. Values: amazon.com, amazon.co.uk, amazon.ca, amazon.de, amazon.fr, amazon.it, amazon.es, amazon.co.jp, amazon.in, amazon.com.au. |
| `postal_code` | string | No | Delivery postal code. The request fails if Amazon cannot apply it; responses include the displayed delivery location. |
| `category` | string | No | Department such as electronics, kitchen, books, beauty or pet supplies. Unsupported departments fail explicitly. |
| `limit` | integer | No | Maximum results in this response. Default: 25. Minimum: 1. Maximum: 100. |
| `cursor` | string | No | next_cursor from a prior response using the same filters and marketplace. |
| `page` | integer | No | Starting upstream page. Prefer cursor to retain unused results and avoid duplicates. Minimum: 1. Maximum: 1000. |

## amazon/deals

Fetch public deals, or search for products with active deal badges. Query pages can be empty after filtering; continue while next_cursor is present. No Amazon sign-in required. Prices and availability reflect the marketplace and delivery location; unavailable fields are null.

| Input | Type | Required | Details |
| --- | --- | --- | --- |
| `marketplace` | string | No | Amazon marketplace. Defaults to the product URL's marketplace, or amazon.com. Values: amazon.com, amazon.co.uk, amazon.ca, amazon.de, amazon.fr, amazon.it, amazon.es, amazon.co.jp, amazon.in, amazon.com.au. |
| `postal_code` | string | No | Delivery postal code. The request fails if Amazon cannot apply it; responses include the displayed delivery location. |
| `query` | string | No |  |
| `category` | string | No | Department such as electronics, kitchen, books, beauty or pet supplies. Unsupported departments fail explicitly. |
| `category_id` | string | No | Amazon browse node ID for a more specific category. |
| `min_price` | number | No | Minimum item price in the marketplace currency. Minimum: 0. |
| `max_price` | number | No | Maximum item price in the marketplace currency. Minimum: 0. |
| `min_rating` | integer | No | Minimum product star rating. Values: 1, 2, 3, 4. |
| `brand` | string | No | Single brand name. |
| `sort` | string | No | Values: relevance, price_asc, price_desc, rating, newest. Default: relevance. |
| `limit` | integer | No | Maximum results in this response. Default: 25. Minimum: 1. Maximum: 100. |
| `cursor` | string | No | next_cursor from a prior response using the same filters and marketplace. |
| `page` | integer | No | Starting upstream page. Prefer cursor to retain unused results and avoid duplicates. Minimum: 1. Maximum: 1000. |

## amazon/product/offers

Compare public seller offers, item condition, shipping and Featured Offer status for a product. Total prices are null when shipping cannot be determined. No Amazon sign-in required. Prices and availability reflect the marketplace and delivery location; unavailable fields are null.

| Input | Type | Required | Details |
| --- | --- | --- | --- |
| `marketplace` | string | No | Amazon marketplace. Defaults to the product URL's marketplace, or amazon.com. Values: amazon.com, amazon.co.uk, amazon.ca, amazon.de, amazon.fr, amazon.it, amazon.es, amazon.co.jp, amazon.in, amazon.com.au. |
| `postal_code` | string | No | Delivery postal code. The request fails if Amazon cannot apply it; responses include the displayed delivery location. |
| `asin` | string | No | Amazon product ASIN. |
| `url` | string | No | Product URL on a supported Amazon marketplace. |
| `limit` | integer | No | Maximum results in this response. Default: 25. Minimum: 1. Maximum: 100. |
| `cursor` | string | No | next_cursor from a prior response using the same filters and marketplace. |
| `page` | integer | No | Starting upstream page. Prefer cursor to retain unused results and avoid duplicates. Minimum: 1. Maximum: 1000. |
| `condition` | string | No | Values: all, new, used, renewed. Default: all. |

Supply `asin` or `url`. When both are supplied, they must identify the same product.

## amazon/product/variations

List related child ASINs and their size, colour and style attributes. Set include_details to fetch each variant's current price and availability (maximum 10 per request). Without it, only the selected variant has product details. No Amazon sign-in required. Prices and availability reflect the marketplace and delivery location; unavailable fields are null.

| Input | Type | Required | Details |
| --- | --- | --- | --- |
| `marketplace` | string | No | Amazon marketplace. Defaults to the product URL's marketplace, or amazon.com. Values: amazon.com, amazon.co.uk, amazon.ca, amazon.de, amazon.fr, amazon.it, amazon.es, amazon.co.jp, amazon.in, amazon.com.au. |
| `postal_code` | string | No | Delivery postal code. The request fails if Amazon cannot apply it; responses include the displayed delivery location. |
| `asin` | string | No | Amazon product ASIN. |
| `url` | string | No | Product URL on a supported Amazon marketplace. |
| `limit` | integer | No | Maximum results in this response. Default: 25. Minimum: 1. Maximum: 100. |
| `cursor` | string | No | next_cursor from a prior response using the same filters and marketplace. |
| `page` | integer | No | Starting upstream page. Prefer cursor to retain unused results and avoid duplicates. Minimum: 1. Maximum: 1000. |
| `include_details` | boolean | No | Default: false. |

Supply `asin` or `url`. When both are supplied, they must identify the same product.

## amazon/products/batch

Fetch up to 10 products by ASIN. Duplicate ASINs are fetched once. Partial batches include per-product errors; all-failed batches fail. No Amazon sign-in required. Prices and availability reflect the marketplace and delivery location; unavailable fields are null.

| Input | Type | Required | Details |
| --- | --- | --- | --- |
| `marketplace` | string | No | Amazon marketplace. Defaults to the product URL's marketplace, or amazon.com. Values: amazon.com, amazon.co.uk, amazon.ca, amazon.de, amazon.fr, amazon.it, amazon.es, amazon.co.jp, amazon.in, amazon.com.au. |
| `postal_code` | string | No | Delivery postal code. The request fails if Amazon cannot apply it; responses include the displayed delivery location. |
| `asins` | array | Yes |  |

## amazon/seller/products

Supply `seller_id` or `seller_url`; a seller URL resolves its merchant ID and marketplace before validation.

Browse a public seller's product catalogue by merchant ID, with optional search, filters, sorting and continuation cursors. No Amazon sign-in required. Prices and availability reflect the marketplace and delivery location; unavailable fields are null.

| Input | Type | Required | Details |
| --- | --- | --- | --- |
| `marketplace` | string | No | Amazon marketplace. Defaults to the product URL's marketplace, or amazon.com. Values: amazon.com, amazon.co.uk, amazon.ca, amazon.de, amazon.fr, amazon.it, amazon.es, amazon.co.jp, amazon.in, amazon.com.au. |
| `postal_code` | string | No | Delivery postal code. The request fails if Amazon cannot apply it; responses include the displayed delivery location. |
| `seller_url` | string | No | HTTPS Amazon seller URL containing seller= or me=. |
| `seller_id` | string | Yes | Merchant ID from a public Amazon seller URL or product offer. |
| `query` | string | No |  |
| `category` | string | No | Department such as electronics, kitchen, books, beauty or pet supplies. Unsupported departments fail explicitly. |
| `category_id` | string | No | Amazon browse node ID for a more specific category. |
| `min_price` | number | No | Minimum item price in the marketplace currency. Minimum: 0. |
| `max_price` | number | No | Maximum item price in the marketplace currency. Minimum: 0. |
| `min_rating` | integer | No | Minimum product star rating. Values: 1, 2, 3, 4. |
| `brand` | string | No | Single brand name. |
| `sort` | string | No | Values: relevance, price_asc, price_desc, rating, newest. Default: relevance. |
| `limit` | integer | No | Maximum results in this response. Default: 25. Minimum: 1. Maximum: 100. |
| `cursor` | string | No | next_cursor from a prior response using the same filters and marketplace. |
| `page` | integer | No | Starting upstream page. Prefer cursor to retain unused results and avoid duplicates. Minimum: 1. Maximum: 1000. |

## amazon/reviews

Supply `asin` or `url`, plus optional `marketplace`, `postal_code`, `limit` (1–100; default 25), `page` or `cursor`. Compatibility aliases `product_url`, `domain` and `maxReviews` are accepted.

Each review includes `id`, `username`, `avatar`, `title`, `rating`, `location`, `date`, `content`, `images`, `helpfulCount`, `verifiedPurchase` and `styleName`. Unavailable scalar fields are null.

`data.coverage` distinguishes `review_listing` from `featured_reviews`. Featured results are a subset and have no continuation cursor. If Amazon requires sign-in even on the product page, the operation fails with `authentication_required`.

## Shared output

All operations return `success`, `source`, `query`, `url`, `results`, `count`, `data`, `max_results_requested` and `pagination`. The pagination object includes `cursor`, `next_cursor`, `has_next_page`, `count` and `strategy`. Continue with the same semantic filters; do not combine a cursor from one query with another. A cursor session is limited to 4,096 returned IDs.

Price fields include displayed `price`, decimal-string `price_amount` and `price_currency`. Recognized displayed currency codes and symbols override the marketplace default. Product detail results also include availability, images, review count, rating and specifications when exposed.

Batch and variation-detail operations include individual failures in `data.errors`. Always inspect that field before treating the run as complete. Unknown input keys are rejected by the public library and CLI.
