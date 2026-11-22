import { readFile, stat } from "node:fs/promises";
import { DIANA_RPC, MAX_FILE_BYTES, SAMPLE_HASH, readReceipt, sha256 } from "../src/protocol.ts";

const [hash = SAMPLE_HASH, filename] = process.argv.slice(2);

try {
  const receipt = await readReceipt(hash, DIANA_RPC);
  if (!receipt) throw new Error("Diana has no indexed receipt for that hash.");
  let fileMatches = null;
  if (filename) {
    const info = await stat(filename);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error("Choose a regular file of 64 MiB or less.");
    fileMatches = receipt.digest === await sha256(await readFile(filename));
  }
  console.log(JSON.stringify({
    chain: "qorechain-diana",
    ...receipt,
    fileMatches,
    explorer: `https://explore.qore.network/tx/${receipt.hash}`,
  }, null, 2));
  if (!receipt.hybridVerified || fileMatches === false) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
