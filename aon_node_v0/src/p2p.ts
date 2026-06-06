import { createLibp2p, type Libp2p } from "libp2p";
import { tcp } from "@libp2p/tcp";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { bootstrap } from "@libp2p/bootstrap";
import { identify } from "@libp2p/identify";
import { pipe } from "it-pipe";
import { fromString, toString } from "uint8arrays";
import { multiaddr } from "@multiformats/multiaddr";

import { getObject, putObject } from "./store.js";
import type { AonObject } from "./object.js";

const TOPIC = "/aon/objects/1";
const OBJECT_PROTOCOL = "/aon/object/1";

let node: Libp2p | null = null;
let started = false;

function jsonBytes(x: unknown) {
  return fromString(JSON.stringify(x));
}

function parseJsonBytes(bytes: Uint8Array) {
  return JSON.parse(toString(bytes));
}

function objectSummary(obj: AonObject) {
  return {
    objectHash: obj.objectHash,
    objectType: obj.objectType,
    namespace: obj.namespace,
    references: obj.references,
    createdAt: obj.createdAt,
  };
}

async function readStreamToBytes(source: any): Promise<Uint8Array> {
  let out = new Uint8Array();

  for await (const chunk of source) {
    const bytes = chunk instanceof Uint8Array ? chunk : chunk.subarray?.() ?? chunk;
    const next = new Uint8Array(out.length + bytes.length);
    next.set(out, 0);
    next.set(bytes, out.length);
    out = next;
  }

  return out;
}

async function fetchObjectFromPeer(peerId: any, objectHash: string) {
  if (!node) throw new Error("P2P_NOT_STARTED");

  const { stream } = await node.dialProtocol(peerId, OBJECT_PROTOCOL);

  const responseBytes = await pipe(
    [jsonBytes({ objectHash })],
    stream,
    async (source) => readStreamToBytes(source)
  );

  const response = parseJsonBytes(responseBytes);

  if (!response.ok || !response.object) {
    throw new Error(response?.error?.code ?? "P2P_OBJECT_FETCH_FAILED");
  }

  const saved = await putObject(response.object);
  return saved;
}

async function handleAnnouncement(msg: any) {
  try {
    const data = parseJsonBytes(msg.detail.data);
    const objectHash = data.objectHash as string;

console.log("[p2p] received announcement", {
  objectHash,
  from: msg.detail.from?.toString?.(),
});

    if (!objectHash) return;
    if (getObject(objectHash)) return;

    const from = msg.detail.from;
    if (!from) return;

    const saved = await fetchObjectFromPeer(from, objectHash);

    if (saved.objectHash) {
      await announceObject(saved);
    }
  } catch (err) {
    console.error("[p2p] announcement failed", err);
  }
}

export async function startP2p() {
  if (started && node) return node;

  const listenPort = Number(process.env.AON_P2P_PORT ?? 0);
  const bootstrapPeers = (process.env.AON_BOOTSTRAP ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  node = await createLibp2p({
    addresses: {
      listen: [`/ip4/0.0.0.0/tcp/${listenPort}`],
    },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: bootstrapPeers.length
      ? [
          bootstrap({
            list: bootstrapPeers,
          }),
        ]
      : [],
    services: {
      identify: identify(),
      pubsub: gossipsub({
        allowPublishToZeroTopicPeers: true,
      }),
    },
  });

await node.handle(OBJECT_PROTOCOL, async ({ stream }) => {
  try {
    const reqBytes = await readStreamToBytes(stream.source);
    const req = parseJsonBytes(reqBytes);

    const objectHash = req.objectHash as string;
    const object = objectHash ? getObject(objectHash) : null;

    const response = object
      ? { ok: true, object }
      : { ok: false, error: { code: "OBJECT_NOT_FOUND" } };

    await pipe([jsonBytes(response)], stream.sink);
  } catch (err) {
    console.error("[p2p] object request failed", err);
  }
});

  node.services.pubsub.addEventListener("message", handleAnnouncement);
  await node.services.pubsub.subscribe(TOPIC);

  started = true;

  console.log("[p2p] peer id", node.peerId.toString());
  console.log("[p2p] listening", node.getMultiaddrs().map((a) => a.toString()));

  return node;
}

export async function announceObject(obj: AonObject) {
  if (!node || !obj.objectHash) return;
console.log("[p2p] announcing object", obj.objectHash);
  await node.services.pubsub.publish(
    TOPIC,
    jsonBytes({
      ...objectSummary(obj),
      announcedAt: Date.now(),
    })
  );
}

export function getP2pInfo() {
  if (!node) {
    return {
      started: false,
      peerId: null,
      multiaddrs: [],
      peers: [],
    };
  }

  return {
    started,
    peerId: node.peerId.toString(),
    multiaddrs: node.getMultiaddrs().map((a) => a.toString()),
    peers: node.getPeers().map((p) => p.toString()),
  };
}

export async function requestObjectFromPeer(peerIdString: string, objectHash: string) {
  if (!node) throw new Error("P2P_NOT_STARTED");

  const peer = node.getPeers().find((p) => p.toString() === peerIdString);

  if (!peer) {
    throw new Error("PEER_NOT_CONNECTED");
  }

  return await fetchObjectFromPeer(peer, objectHash);
}

export async function dialPeer(addr: string) {
  if (!node) throw new Error("P2P_NOT_STARTED");

  const ma = multiaddr(addr);
  await node.dial(ma);

  return getP2pInfo();
}
