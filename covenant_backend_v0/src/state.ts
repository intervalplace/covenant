import type { Hex } from "viem";
import type { StoredAuth, StoredOrder, FillRecord } from "./types.js";

export const auths = new Map<Hex, StoredAuth>();
export const orders = new Map<Hex, StoredOrder>();
export const fills = new Map<Hex, FillRecord>();

export function serializeBigInts(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serializeBigInts);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = serializeBigInts(v);
    return out;
  }
  return value;
}
