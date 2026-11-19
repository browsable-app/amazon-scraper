import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
const ajv = new Ajv2020({ strict: false, allErrors: true });
const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => void;
addFormats(ajv);
const cache = new WeakMap<object, ReturnType<Ajv2020["compile"]>>();
export function validateJsonSchemaValue(schema: object, value: unknown) {
  let validate = cache.get(schema);
  if (!validate) { validate = ajv.compile(schema); cache.set(schema, validate); }
  const valid = !!validate(value);
  return { valid, errors: validate.errors ?? [] };
}
