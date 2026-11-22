import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { getQorexNative, qorexSignAndBroadcast } from "@qorechain/qorex-types";
import {
  CHAIN_ID, DENOM, SAMPLE_HASH, fingerprint, normalizeHash, readReceipt, stampRequest, type Receipt,
} from "./protocol.ts";
import "./styles.css";

const RPC = "/diana-rpc";
const FAUCET = "https://dashboard.qorechain.io/faucet";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function wallet() {
  const native = getQorexNative();
  if (typeof native?.signAndBroadcast !== "function") {
    throw new Error("Open this page in an up-to-date QoreX browser or install the QoreX extension, then select Testnet.");
  }
  return native;
}

function explorerUrl(hash: string) {
  return `https://explore.qore.network/tx/${hash}`;
}

async function getBalance(address: string): Promise<string> {
  const response = await fetch(`/lcd/cosmos/bank/v1beta1/balances/${encodeURIComponent(address)}/by_denom?denom=${DENOM}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Diana balance unavailable.");
  const { balance } = await response.json() as { balance: { amount: string } | null };
  if (balance === null) return "0";
  if (!/^\d+$/.test(balance?.amount)) throw new Error("Diana returned an invalid balance.");
  return balance.amount;
}

function Copy({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState("");
  return (
    <span className="copy">
      <button type="button" className="text-button" onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setStatus("Copied");
        } catch {
          setStatus("Select the text to copy");
        }
      }}>{label}</button>
      <small role="status">{status}</small>
    </span>
  );
}

function ReceiptView({ receipt, digest }: { receipt: Receipt; digest?: string }) {
  return (
    <div className="receipt" aria-live="polite">
      <p className={receipt.hybridVerified ? "tag verified" : "tag"}>
        {receipt.hybridVerified ? "Hybrid signature verified" : receipt.code === 0 ? "Hybrid verification absent" : "Transaction failed"}
      </p>
      <dl>
        <dt>Block</dt><dd>{receipt.height}</dd>
        <dt>Block time</dt><dd>{new Date(receipt.time).toISOString().replace("T", " ").replace(".000Z", " UTC").replace("Z", " UTC")}</dd>
        <dt>Tx hash</dt><dd><code>{receipt.hash}</code></dd>
        {receipt.signer && <><dt>Signer</dt><dd><code>{receipt.signer}</code></dd></>}
        {receipt.digest && <><dt>Fingerprint</dt><dd><code>{receipt.digest}</code></dd></>}
      </dl>
      {receipt.hybridVerified && <p className="chain-check">Diana reported verification of secp256k1 + ML-DSA-87.</p>}
      {receipt.digest && digest && <p className={digest === receipt.digest ? "match" : "mismatch"}>
        {digest === receipt.digest ? "Selected file matches this stamp." : "Selected file differs from this stamp."}
      </p>}
      {receipt.digest && !digest && <p className="muted">Choose a local file to compare its fingerprint.</p>}
      {!receipt.digest && receipt.hybridVerified && <p className="muted">This transaction has no Stillmark stamp.</p>}
      <div className="receipt-actions">
        <a href={explorerUrl(receipt.hash)} target="_blank" rel="noreferrer" title="Select Testnet in the explorer">Diana explorer ↗</a>
        <Copy key={receipt.hash} value={receipt.hash} label="Copy hash" />
      </div>
    </div>
  );
}

export function App() {
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState<string | null>(null);
  const [walletError, setWalletError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [balanceRevision, setBalanceRevision] = useState(0);
  const [file, setFile] = useState<{ name: string; digest: string } | null>(null);
  const [hashing, setHashing] = useState(false);
  const [fileError, setFileError] = useState("");
  const [hash, setHash] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [lookupMessage, setLookupMessage] = useState("");
  const [busy, setBusy] = useState<"sign" | "lookup" | null>(null);
  const [signError, setSignError] = useState("");
  const fileSelection = useRef(0);

  useEffect(() => {
    if (!address) return;
    let current = true;
    setLoadingBalance(true);
    getBalance(address).then(
      (amount) => { if (current) setBalance(amount); },
      () => { if (current) setBalance(null); },
    ).finally(() => { if (current) setLoadingBalance(false); });
    return () => { current = false; };
  }, [address, balanceRevision]);

  async function connect() {
    setWalletError("");
    setAddress("");
    setBalance(null);
    setConnecting(true);
    try {
      const native = wallet();
      await native.enable(CHAIN_ID);
      setAddress((await native.getKey(CHAIN_ID)).bech32Address);
      setBalanceRevision((revision) => revision + 1);
    } catch (error) {
      setWalletError(errorText(error));
    } finally {
      setConnecting(false);
    }
  }

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.currentTarget.files?.[0];
    const selection = ++fileSelection.current;
    setFile(null);
    setFileError("");
    setSignError("");
    setHashing(Boolean(selected));
    if (!selected) return;
    try {
      const digest = await fingerprint(selected);
      if (selection === fileSelection.current) setFile({ name: selected.name, digest });
    } catch (error) {
      if (selection === fileSelection.current) setFileError(errorText(error));
    } finally {
      if (selection === fileSelection.current) setHashing(false);
    }
  }

  async function lookup(input: string) {
    setBusy("lookup");
    setReceipt(null);
    setLookupMessage("");
    try {
      const normalized = normalizeHash(input);
      setHash(normalized);
      const found = await readReceipt(normalized, RPC);
      setReceipt(found);
      if (!found) setLookupMessage("Diana has no indexed receipt for this hash yet. Try again after the next block.");
    } catch (error) {
      setLookupMessage(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  async function sign() {
    if (!file || !address || busy) return;
    setBusy("sign");
    setSignError("");
    let broadcastHash: string | undefined;
    try {
      const native = wallet();
      const active = (await native.getKey(CHAIN_ID)).bech32Address;
      if (active !== address) throw new Error("The active account changed. Reconnect QoreX before signing.");
      const result = await qorexSignAndBroadcast(stampRequest(address, file.digest), { native });
      broadcastHash = normalizeHash(result.txHash);
      setHash(broadcastHash);
      setReceipt(null);
      setLookupMessage("Waiting for the Diana receipt…");

      let found = await readReceipt(broadcastHash, RPC);
      for (let attempt = 0; !found && attempt < 8; attempt++) {
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        found = await readReceipt(broadcastHash, RPC);
      }
      setReceipt(found);
      setLookupMessage(found ? "" : "Broadcast returned a hash. Use Verify receipt to check again when Diana indexes it.");
      if (found && (found.digest !== file.digest || found.signer !== address)) {
        setSignError("The chain receipt does not confirm this stamp. Review it before signing again.");
      }
      setBalanceRevision((revision) => revision + 1);
    } catch (error) {
      if (broadcastHash) setLookupMessage("Broadcast returned a hash. Use Verify receipt to retry the Diana lookup.");
      setSignError(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  const visibleBalance = balance === null ? "Unavailable" :
    `${BigInt(balance) / 1_000_000n}.${(BigInt(balance) % 1_000_000n).toString().padStart(6, "0")} QOR`;

  return (
    <div className="shell">
      <header className="topbar">
        <a href="./" className="brand"><span className="brand-mark" aria-hidden="true" />Stillmark</a>
        <div className="wallet-controls">
          <span className="network"><span className="network-dot" />Diana testnet</span>
          <button type="button" className="secondary" disabled={connecting || busy === "sign"} onClick={connect}>
            {connecting ? "Connecting…" : address ? "Reconnect QoreX" : "Connect QoreX"}
          </button>
        </div>
      </header>
      <main>
        <section className="hero" aria-labelledby="page-title">
          <div className="hero-content">
            <p className="eyebrow">File timestamping on QoreChain</p>
            <h1 id="page-title">A receipt for<br /> your file.</h1>
            <p className="hero-copy">Anchor a SHA-256 fingerprint on Diana with a QoreX hybrid signature. Anyone with the original file can check it against the receipt.</p>
          </div>
        </section>
        <section className="account" aria-label="Wallet and funding">
          <div className="account-details">
            <span className="small-label">Native QoreX account</span>
            {address ? <code>{address}</code> : <span>Connect a QoreX wallet on Testnet to create a stamp.</span>}
            {walletError && <p className="error" role="alert">{walletError} <a href="https://qorechain.io/qorex" target="_blank" rel="noreferrer">Get QoreX ↗</a></p>}
          </div>
          <div className="funding">
            {address && <>
              <Copy key={address} value={address} label="Copy address" />
              <button className="text-button balance" type="button" onClick={() => setBalanceRevision((revision) => revision + 1)} disabled={loadingBalance}
                aria-label="Refresh test QOR balance" title="Refresh test QOR balance">
                {loadingBalance ? "Loading balance…" : visibleBalance} ↻
              </button>
            </>}
            <a className="faucet" href={FAUCET} target="_blank" rel="noreferrer">Free test QOR ↗</a>
          </div>
        </section>
        <div className="workspace">
          <section className="panel" aria-labelledby="stamp-heading">
            <h2 id="stamp-heading">Create a stamp</h2>
            <p className="muted">Hash a file in your browser. Its contents and name stay on your device.</p>
            <label className="file-area">
              <span className="small-label">Local file · up to 64 MiB</span>
              <input type="file" onChange={selectFile} disabled={busy === "sign"} />
            </label>
            {hashing && <p role="status">Computing fingerprint…</p>}
            {fileError && <p className="error" role="alert">{fileError}</p>}
            {file && (
              <div className="fingerprint">
                <span className="small-label">SHA-256 · {file.name}</span>
                <code>{file.digest}</code>
              </div>
            )}
            <p className="fineprint">QoreX approves a 0.001 test QOR self-transfer plus a testnet fee. The fingerprint becomes a public memo.</p>
            <button className="primary" type="button" onClick={sign} disabled={!address || !file || Boolean(busy) || connecting}>
              {busy === "sign" ? "Signing or confirming…" : "Sign and stamp"}
            </button>
            {signError && <p className="error" role="alert">{signError}</p>}
          </section>
          <section className="panel" aria-labelledby="receipt-heading">
            <h2 id="receipt-heading">Verify a receipt</h2>
            <p className="muted">Read the committed transaction and hybrid verification event from Diana.</p>
            <form onSubmit={(event) => { event.preventDefault(); if (!busy) void lookup(hash); }}>
              <label htmlFor="hash" className="small-label">Transaction hash</label>
              <input id="hash" value={hash} onChange={(event) => {
                setHash(event.target.value);
                setReceipt(null);
                setLookupMessage("");
              }} placeholder="Enter the 64-character hash" spellCheck={false} autoComplete="off" disabled={Boolean(busy)} />
              <div className="receipt-actions">
                <button className="secondary" disabled={Boolean(busy) || !hash.trim()}>{busy === "lookup" ? "Looking up…" : "Verify receipt"}</button>
                <button className="text-button" type="button" onClick={() => lookup(SAMPLE_HASH)} disabled={Boolean(busy)}>Look up public example</button>
              </div>
            </form>
            {lookupMessage && <p className="lookup-message" role="status">{lookupMessage}</p>}
            {receipt && <ReceiptView receipt={receipt} digest={file?.digest} />}
          </section>
        </div>
      </main>
      <footer>
        <span>Build Before Q-Day · Post-Quantum dApp</span>
        <a href="https://github.com/ZQ051031/qorechain-devfest">Source on GitHub ↗</a>
      </footer>
    </div>
  );
}
