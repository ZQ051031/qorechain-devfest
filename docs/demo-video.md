# Stillmark demo recording

Target length **2:40**. Record your browser and QoreX approval window. Use free QOR on Diana. The recording shows one Stillmark transaction you approve and the corresponding on-chain receipt.

## Before recording

1. Follow the README setup and open Stillmark at `http://localhost:5173`.
2. Set QoreX to **Testnet** and select your native `qor1…` account. Claim free Diana QOR from the official faucet before starting the recording. Keep a tab open for the faucet, with any personal profile UI hidden.
3. Save a plain-text file named `stillmark-demo.txt` containing `Stillmark Diana demo`. Save a second file named `stillmark-changed.txt` containing `Stillmark Diana demo!`. Keep both available in your file picker.
4. Open the QoreChain explorer in a separate tab, choose **Testnet**, and return to Stillmark. Start from the app with the wallet disconnected. Capture the full browser window so the wallet approval is visible.

## Recording steps and narration

| Time | On screen | Say |
| --- | --- | --- |
| 0:00–0:18 | Start on the Stillmark home screen. | “Stillmark gives a file an on-chain timestamp. I can share a receipt so someone else can check that their copy matches what I stamped.” |
| 0:18–0:43 | Click **Connect QoreX**, approve, and point to your `qor1…` address and balance. Point to **Free test QOR** or briefly show the faucet tab. | “This is my native QoreX account on Diana. I funded it with free test QOR from the official faucet.” |
| 0:43–1:02 | In **Create a stamp**, select `stillmark-demo.txt`. Point to the fingerprint. | “Stillmark hashes the file here in the browser. The transaction contains the public fingerprint. The file and its name stay on this device.” |
| 1:02–1:35 | Click **Sign and stamp**. Show the QoreX prompt, review the self-transfer and fee, then approve. Wait for the receipt. | “QoreX builds this native self-transfer and signs with both secp256k1 and ML-DSA-87. The test QOR transfer returns to my address, and I pay a testnet fee.” |
| 1:35–2:00 | Show **Hybrid signature verified**, block, fingerprint, and **Selected file matches this stamp**. Copy the hash and open **Diana explorer**. Point to the same hash and block. | “Stillmark reads back the committed bytes and Diana's hybrid verification event. This is the same transaction in the explorer.” |
| 2:00–2:28 | Open Stillmark in another tab. Paste the hash, click **Verify receipt**, select the original file, then select the changed copy. | “Verification works without connecting a wallet. The original file matches. Adding one character gives a different fingerprint, so the second copy fails the comparison.” |
| 2:28–2:40 | Return to the verified receipt and hold the hash long enough to read. | “This receipt ties the file fingerprint to this signer and block time on Diana.” |

If indexing takes a while, trim the wait while keeping the approval and the resulting receipt visible. Keep the exported video under 3 minutes. Save the hash, explorer link, and address from the same successful stamp for the project entry.
