export const auths = new Map();
export const orders = new Map();
export const fills = new Map();
export function serializeBigInts(value) {
    if (typeof value === "bigint")
        return value.toString();
    if (Array.isArray(value))
        return value.map(serializeBigInts);
    if (value && typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value))
            out[k] = serializeBigInts(v);
        return out;
    }
    return value;
}
