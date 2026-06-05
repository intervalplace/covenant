import { createHash } from "crypto";
import type { Hex } from "viem";

export type CsdProof = any;

function strip0x(x: string) {
  return x.startsWith("0x") ? x.slice(2) : x;
}

function hexToBuf(x: string) {
  return Buffer.from(strip0x(x), "hex");
}

function toHex(buf: Buffer): Hex {
  return `0x${buf.toString("hex")}` as Hex;
}

function sha256(buf: Buffer) {
  return createHash("sha256").update(buf).digest();
}

function dsha(buf: Buffer) {
  return sha256(sha256(buf));
}

function u32le(n: number) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

function u64le(n: number | bigint) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

function readU32LE(buf: Buffer, off: number) {
  return buf.readUInt32LE(off);
}

function readU64LE(buf: Buffer, off: number) {
  return Number(buf.readBigUInt64LE(off));
}

// CSD txid = double-sha256(tx serialization with input script_sig removed)
function csdTxidFromRaw(txRaw: Hex): Hex {
  const raw = hexToBuf(txRaw);
  let off = 0;

  const parts: Buffer[] = [];

  parts.push(raw.subarray(off, off + 4)); // version
  off += 4;

  const inputCountBytes = raw.subarray(off, off + 8);
  const inputCount = readU64LE(raw, off);
  parts.push(inputCountBytes);
  off += 8;

  for (let i = 0; i < inputCount; i++) {
    parts.push(raw.subarray(off, off + 32)); // prev txid
    off += 32;

    parts.push(raw.subarray(off, off + 4)); // vout
    off += 4;

    const scriptLen = readU64LE(raw, off);
    off += 8;

    parts.push(u64le(0)); // empty script_sig for txid
    off += scriptLen;
  }

  parts.push(raw.subarray(off)); // outputs + locktime/app tail

  return toHex(dsha(Buffer.concat(parts)));
}

function csdMerkleRoot(txid: Hex, branch: { hash: Hex; position: "left" | "right" }[]): Hex {
  let cur = hexToBuf(txid);

  for (const item of branch) {
    const sibling = hexToBuf(item.hash);
    cur = item.position === "left"
      ? dsha(Buffer.concat([sibling, cur]))
      : dsha(Buffer.concat([cur, sibling]));
  }

  return toHex(cur);
}

function csdHeaderHash(header: CsdProof["header"]): Hex {
  const encoded = Buffer.concat([
    u32le(header.version),
    hexToBuf(header.prev),
    hexToBuf(header.merkle),
    u64le(header.time),
    u32le(header.bits),
    u32le(header.nonce),
  ]);

  return toHex(dsha(encoded));
}

export function verifyCsdPaymentProof(args: {
  proof: CsdProof;
  expectedRecipientScriptPubKey: Hex;
  expectedIntentHash?: Hex;
  expectedAmount: bigint;
  minConfirmations: number;
}) {
  const { proof, expectedRecipientScriptPubKey, expectedAmount, minConfirmations } = args;

  if (!proof.ok) throw new Error("CSD_PROOF_NOT_OK");
  if (proof.confirmations < minConfirmations) throw new Error("CSD_CONFIRMATIONS_TOO_LOW");

  const txid = csdTxidFromRaw(proof.tx_raw);
  if (txid.toLowerCase() !== proof.txid.toLowerCase()) throw new Error("CSD_TXID_INVALID");
  if (proof.tx.txid.toLowerCase() !== proof.txid.toLowerCase()) throw new Error("CSD_TX_JSON_MISMATCH");

  const merkle = csdMerkleRoot(proof.txid, proof.merkle_branch ?? []);
  if (merkle.toLowerCase() !== proof.header.merkle.toLowerCase()) throw new Error("CSD_MERKLE_INVALID");

  const blockHash = csdHeaderHash(proof.header);
  if (blockHash.toLowerCase() !== proof.block_hash.toLowerCase()) throw new Error("CSD_BLOCK_HASH_INVALID");

  const paid = proof.tx.outputs.some((o: any) =>
    o.script_pubkey.toLowerCase() === expectedRecipientScriptPubKey.toLowerCase() &&
    BigInt(o.value) >= expectedAmount
  );

if (args.expectedIntentHash) {
  const appIntentHash =
    proof.tx?.app?.intentHash ??
    proof.tx?.app?.value?.intentHash ??
    proof.tx?.app?.data?.intentHash;

  if (!appIntentHash) {
    throw new Error("CSD_INTENT_HASH_MISSING");
  }

  if (appIntentHash.toLowerCase() !== args.expectedIntentHash.toLowerCase()) {
    throw new Error("CSD_INTENT_HASH_MISMATCH");
  }
}

  if (!paid) throw new Error("CSD_PAYMENT_OUTPUT_NOT_FOUND");

if (!proof.genesis_hash) throw new Error("CSD_GENESIS_HASH_MISSING");

  return {
    ok: true,
    txid: proof.txid,
    blockHash: proof.block_hash,
    height: proof.height,
    confirmations: proof.confirmations,
    genesisHash: proof.genesis_hash,
  };
}
