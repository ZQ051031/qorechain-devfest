import assert from "node:assert/strict";
import test from "node:test";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { AuthInfo, TxBody, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import {
  CHAIN_ID, DENOM, MAX_FILE_BYTES, STAMP_AMOUNT, fingerprint, inspectReceipt,
  normalizeHash, sha256, stampRequest, type ChainTx,
} from "../src/protocol.ts";

const ADDRESS = "qor1ff44amgm07w2nrfuk6u25kfu8tlprdm2yj52dp";
const DIGEST = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const HEADER = { height: "12345", chain_id: CHAIN_ID, time: "2026-11-22T10:04:24Z" };
const extension = { typeUrl: "/qorechain.pqc.v1.PQCHybridSignature", value: Uint8Array.of(8, 1) };
const verified = {
  type: "pqc_hybrid_verify",
  attributes: [
    { key: "address", value: ADDRESS },
    { key: "algorithm_id", value: "dilithium5" },
    { key: "status", value: "verified" },
  ],
};

// Synthetic committed-response shape. Nothing here signs or contacts a wallet.
async function buildReceipt({
  code = 0, events = [verified], critical = [extension], nonCritical = [] as typeof critical,
  sender = ADDRESS, receiver = ADDRESS, memo = stampRequest(ADDRESS, DIGEST).memo,
} = {}): Promise<ChainTx> {
  const bodyBytes = TxBody.encode(TxBody.fromPartial({
    extensionOptions: critical,
    nonCriticalExtensionOptions: nonCritical,
    memo,
    messages: [{
      typeUrl: "/cosmos.bank.v1beta1.MsgSend",
      value: MsgSend.encode({
        fromAddress: sender,
        toAddress: receiver,
        amount: [{ denom: DENOM, amount: STAMP_AMOUNT }],
      }).finish(),
    }],
  })).finish();
  const authInfoBytes = AuthInfo.encode(AuthInfo.fromPartial({
    signerInfos: [{ publicKey: { typeUrl: "/cosmos.crypto.secp256k1.PubKey" } }],
  })).finish();
  const bytes = TxRaw.encode({ bodyBytes, authInfoBytes, signatures: [new Uint8Array(64)] }).finish();
  return {
    hash: (await sha256(bytes)).toUpperCase(),
    height: HEADER.height,
    tx: Buffer.from(bytes).toString("base64"),
    tx_result: { code, events },
  };
}

test("hashes exact file bytes and rejects oversized inputs", async () => {
  assert.equal(await fingerprint(new File(["abc"], "local.txt")), DIGEST);
  assert.notEqual(await fingerprint(new File(["abc\n"], "local.txt")), DIGEST);
  await assert.rejects(fingerprint({ size: MAX_FILE_BYTES + 1 } as File), /64 MiB/);
});

test("builds a native self-transfer with the versioned fingerprint and no filename", () => {
  const request = stampRequest(ADDRESS, DIGEST);
  assert.equal(request.chainId, CHAIN_ID);
  assert.equal(request.memo, `stillmark:v1:sha256:${DIGEST}`);
  assert.deepEqual(MsgSend.decode(Uint8Array.from(request.messages[0].value)), {
    fromAddress: ADDRESS,
    toAddress: ADDRESS,
    amount: [{ amount: "1000", denom: "uqor" }],
  });
  assert.throws(() => stampRequest("0x1234", DIGEST), /native QoreX/);
});

test("accepts a matching Diana hybrid receipt and extracts the fingerprint", async () => {
  const tx = await buildReceipt();
  const receipt = await inspectReceipt(tx.hash, tx, HEADER);
  assert.equal(receipt.hybridVerified, true);
  assert.equal(receipt.digest, DIGEST);
  assert.equal(receipt.signer, ADDRESS);
  assert.equal(normalizeHash(` 0x${tx.hash.toLowerCase()} `), tx.hash);
  assert.throws(() => normalizeHash("123"), /64-character/);
});

test("rejects wrong-chain, mismatched-height, and substituted transaction bytes", async () => {
  const tx = await buildReceipt();
  await assert.rejects(inspectReceipt(tx.hash, tx, { ...HEADER, chain_id: "qorechain-vladi" }), /Diana block/);
  await assert.rejects(inspectReceipt(tx.hash, tx, { ...HEADER, height: "12346" }), /Diana block/);
  await assert.rejects(inspectReceipt(tx.hash, { ...tx, tx: "YWJj" }, HEADER), /bytes did not match/);
});

test("requires both a successful hybrid event and exactly one critical extension", async () => {
  for (const options of [
    { code: 1 }, { events: [] }, { events: [verified, verified] },
    { critical: [] }, { critical: [extension, extension] },
    { critical: [], nonCritical: [extension] },
    { events: [{ ...verified, attributes: verified.attributes.filter(({ key }) => key !== "algorithm_id") }] },
  ]) {
    const tx = await buildReceipt(options);
    const receipt = await inspectReceipt(tx.hash, tx, HEADER);
    assert.equal(receipt.hybridVerified, false);
    assert.equal(receipt.digest, null);
  }
});

test("distinguishes a generic hybrid transaction from a Stillmark stamp", async () => {
  for (const options of [{ memo: "other app" }, { receiver: "qor1different" }, { sender: "qor1different" }]) {
    const tx = await buildReceipt(options);
    const receipt = await inspectReceipt(tx.hash, tx, HEADER);
    assert.equal(receipt.hybridVerified, true);
    assert.equal(receipt.digest, null);
  }
});
