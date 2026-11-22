import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { AuthInfo, TxBody, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";

export const CHAIN_ID = "qorechain-diana";
export const DENOM = "uqor";
export const STAMP_AMOUNT = "1000";
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export const DIANA_RPC = "https://rpc-testnet.qore.host";
export const SAMPLE_HASH = "C9C675AF8A17FF8F783FBB8CDCD5EA768462E240F57750F0D8CA5E15F0104E39";
const MEMO_PREFIX = "stillmark:v1:sha256:";
const MSG_SEND = "/cosmos.bank.v1beta1.MsgSend";
const HYBRID_EXTENSION = "/qorechain.pqc.v1.PQCHybridSignature";
const SECP256K1_KEYS = new Set([
  "/cosmos.crypto.secp256k1.PubKey",
  "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey",
  "/ethermint.crypto.v1.ethsecp256k1.PubKey",
]);

export interface ChainTx {
  hash: string;
  height: string;
  tx: string;
  tx_result: {
    code: number;
    events?: Array<{ type: string; attributes: Array<{ key: string; value: string }> }>;
  };
}

export interface ChainHeader {
  height: string;
  chain_id: string;
  time: string;
}

export interface Receipt {
  hash: string;
  height: string;
  time: string;
  code: number;
  signer: string | null;
  hybridVerified: boolean;
  digest: string | null;
}

export function normalizeHash(input: string): string {
  const hash = input.trim().replace(/^0x/i, "");
  if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error("Enter a 64-character transaction hash.");
  return hash.toUpperCase();
}

export async function sha256(bytes: BufferSource): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function fingerprint(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new Error("Choose a file of 64 MiB or less.");
  return sha256(await file.arrayBuffer());
}

export function stampRequest(address: string, digest: string) {
  if (!/^qor1[02-9ac-hj-np-z]{38}$/.test(address)) throw new Error("Select a native QoreX testnet account.");
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error("Choose a file before requesting a stamp.");
  const value = MsgSend.encode({
    fromAddress: address,
    toAddress: address,
    amount: [{ denom: DENOM, amount: STAMP_AMOUNT }],
  }).finish();
  return {
    chainId: CHAIN_ID,
    messages: [{ typeUrl: MSG_SEND, value: Array.from(value) }],
    memo: MEMO_PREFIX + digest,
  };
}

export async function inspectReceipt(hash: string, chainTx: ChainTx, header: ChainHeader): Promise<Receipt> {
  if (header.chain_id !== CHAIN_ID || header.height !== chainTx.height || !/^[1-9]\d*$/.test(header.height)) {
    throw new Error("The receipt did not match a Diana block.");
  }
  if (!Number.isFinite(Date.parse(header.time)) || !Number.isInteger(chainTx.tx_result.code)) {
    throw new Error("Diana returned an incomplete receipt.");
  }
  const bytes = Uint8Array.from(atob(chainTx.tx), (byte) => byte.charCodeAt(0));
  if (chainTx.hash !== hash || (await sha256(bytes)).toUpperCase() !== hash) {
    throw new Error("The transaction bytes did not match the requested hash.");
  }

  const raw = TxRaw.decode(bytes);
  const body = TxBody.decode(raw.bodyBytes);
  const auth = AuthInfo.decode(raw.authInfoBytes);
  const key = auth.signerInfos[0]?.publicKey?.typeUrl;
  const pqEvents = (chainTx.tx_result.events ?? []).filter((event) => event.type === "pqc_hybrid_verify");
  const attributes = pqEvents.length === 1
    ? Object.fromEntries(pqEvents[0].attributes.map(({ key, value }) => [key, value]))
    : {};
  const signer = attributes.address || null;
  const hybridVerified =
    chainTx.tx_result.code === 0 &&
    body.extensionOptions.filter(({ typeUrl }) => typeUrl === HYBRID_EXTENSION).length === 1 &&
    auth.signerInfos.length === 1 &&
    key !== undefined && SECP256K1_KEYS.has(key) &&
    raw.signatures.length === 1 && [64, 65].includes(raw.signatures[0].length) &&
    attributes.status === "verified" && attributes.algorithm_id === "dilithium5" && signer !== null;

  const [message] = body.messages;
  const memoDigest = body.memo.startsWith(MEMO_PREFIX) ? body.memo.slice(MEMO_PREFIX.length) : "";
  let digest = null;
  if (hybridVerified && /^[0-9a-f]{64}$/.test(memoDigest) &&
      body.messages.length === 1 && message?.typeUrl === MSG_SEND) {
    const transfer = MsgSend.decode(message.value);
    if (transfer.fromAddress === signer && transfer.toAddress === signer &&
        transfer.amount.length === 1 && transfer.amount[0].denom === DENOM &&
        transfer.amount[0].amount === STAMP_AMOUNT) {
      digest = memoDigest;
    }
  }

  return { hash, height: header.height, time: header.time, code: chainTx.tx_result.code, signer, hybridVerified, digest };
}

async function rpc<T>(url: string, allowMissing = false): Promise<T | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
  const payload = await response.json() as { result?: T; error?: { code: number; data?: string } };
  if (allowMissing && payload.error?.code === -32603 && /^tx \([0-9a-f]{64}\) not found$/i.test(payload.error.data ?? "")) {
    return null;
  }
  if (!response.ok || !payload.result) throw new Error("Diana RPC is unavailable. Try the lookup again.");
  return payload.result;
}

export async function readReceipt(input: string, endpoint: string): Promise<Receipt | null> {
  const hash = normalizeHash(input);
  const transaction = await rpc<ChainTx>(`${endpoint}/tx?hash=0x${hash}`, true);
  if (!transaction) return null;
  if (!/^[1-9]\d*$/.test(transaction.height)) throw new Error("Diana returned an invalid block height.");
  const block = await rpc<{ header: ChainHeader }>(`${endpoint}/header?height=${transaction.height}`);
  if (!block) throw new Error("Could not load the Diana block header.");
  return inspectReceipt(hash, transaction, block.header);
}
