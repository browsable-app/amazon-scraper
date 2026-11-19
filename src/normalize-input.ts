import { amazonMarketplace } from "./amazonCommon.js";

export function normalizePrebuiltTaskInput(source: string, input: Record<string, unknown>, _schema: unknown = {}) {
  const output = { ...input };
  const issues: { instancePath: string; message: string }[] = [];
  const problem = (field: string, message: string) => issues.push({ instancePath: "/" + field, message });
  for (const name of ["query", "url", "seller_url", "asin", "postal_code"]) {
    if (typeof output[name] === "string") {
      output[name] = output[name].trim();
      if (!output[name]) problem(name, `${name} must not be blank.`);
    }
  }
  for (const [alias, target] of [["q", "query"], ["domain", "marketplace"], ["maxResults", "limit"], ["maxReviews", "limit"], ["product_url", "url"]]) {
    if (output[alias] !== undefined) {
      if (output[target] !== undefined && output[target] !== output[alias]) problem(alias, `Use ${alias} or ${target}; conflicting values were supplied.`);
      else output[target] = output[alias];
      delete output[alias];
    }
  }
  if (output.marketplace !== undefined) {
    try { output.marketplace = amazonMarketplace(output.marketplace); }
    catch (error) { problem("marketplace", (error as Error).message); }
  }
  if (source === "amazon-seller-products" && typeof output.seller_url === "string") {
    try {
      const u = new URL(output.seller_url);
      const marketplace = amazonMarketplace(undefined, u.toString());
      const id = u.searchParams.get("seller") ?? u.searchParams.get("me");
      if (!id || !/^[A-Z0-9]{8,32}$/.test(id)) throw Error("Seller URL must contain a valid seller= or me= merchant ID.");
      if (output.seller_id && output.seller_id !== id) throw Error("seller_url and seller_id identify different sellers.");
      if (output.marketplace && output.marketplace !== marketplace) throw Error("marketplace must match the Amazon seller URL.");
      output.seller_id = id;
      output.marketplace ??= marketplace;
    } catch (error) { problem("seller_url", (error as Error).message); }
  }
  return { input: output, issues };
}
