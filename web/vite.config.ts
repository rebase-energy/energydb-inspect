import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// VITE_BASE sets the GitHub Pages sub-path for the WASM build (e.g.
// /energydb-inspector/); defaults to "/" for dev + the server-backed build.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
  // Compile-time target literal so the unused branch in main.tsx is dead-code
  // eliminated: the server build then never pulls in the web-only chunk.
  define: {
    __WASM_TARGET__: JSON.stringify(process.env.VITE_TARGET === "wasm" ? "wasm" : "server"),
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
    },
  },
});
