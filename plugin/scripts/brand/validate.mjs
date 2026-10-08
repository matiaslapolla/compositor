// Small JSON-schema subset validator (type, required, properties, enum, const,
// pattern, items, minItems, maxItems, $ref to #/$defs, additionalProperties).
import { readJson } from "../lib/fs.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SCHEMA = readJson(join(dirname(fileURLToPath(import.meta.url)), "schema.json"));

export function validateBrand(data, schema = SCHEMA, path = "$", errors = [], root = SCHEMA) {
  if (schema.$ref) return validateBrand(data, deref(schema.$ref, root), path, errors, root);
  if ("const" in schema && data !== schema.const) errors.push(`${path}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(data)) errors.push(`${path}: expected one of ${schema.enum.join("|")}, got ${JSON.stringify(data)}`);
  if (schema.type) {
    const types = [].concat(schema.type);
    const actual = data === null ? "null" : Array.isArray(data) ? "array" : typeof data;
    if (!types.includes(actual)) { errors.push(`${path}: expected ${types.join("|")}, got ${actual}`); return errors; }
  }
  if (typeof data === "string") {
    if (schema.minLength && data.length < schema.minLength) errors.push(`${path}: too short`);
    if (schema.pattern && !new RegExp(schema.pattern).test(data)) errors.push(`${path}: ${JSON.stringify(data)} does not match ${schema.pattern}`);
  }
  if (Array.isArray(data)) {
    if (schema.minItems && data.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems && data.length > schema.maxItems) errors.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items) data.forEach((d, i) => validateBrand(d, schema.items, `${path}[${i}]`, errors, root));
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const req of schema.required ?? []) if (!(req in data)) errors.push(`${path}.${req}: missing`);
    for (const [k, sub] of Object.entries(schema.properties ?? {})) if (k in data) validateBrand(data[k], sub, `${path}.${k}`, errors, root);
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      for (const k of Object.keys(data)) if (!(schema.properties ?? {})[k]) validateBrand(data[k], schema.additionalProperties, `${path}.${k}`, errors, root);
    }
  }
  return errors;
}

function deref(ref, root) {
  return ref.replace(/^#\//, "").split("/").reduce((o, k) => o[k], root);
}
