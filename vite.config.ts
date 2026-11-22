import react from "@vitejs/plugin-react";
import { NETWORKS } from "@qorechain/sdk";
import { defineConfig } from "vite";

// Diana's public endpoints do not send browser CORS headers.
const { rpc, rest } = NETWORKS.testnet.endpoints;
const proxy = {
  "^/diana-rpc/(?:tx\\?hash=0x[0-9A-F]{64}|header\\?height=[1-9][0-9]*)$": {
    target: rpc,
    changeOrigin: true,
    rewrite: (path: string) => path.slice("/diana-rpc".length),
  },
  "^/lcd/cosmos/bank/v1beta1/balances/qor1[a-z0-9]{38}/by_denom\\?denom=uqor$": {
    target: rest,
    changeOrigin: true,
    rewrite: (path: string) => path.slice("/lcd".length),
  },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy },
  preview: { proxy },
});
