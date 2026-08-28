import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import { waitForSessionCreds } from "./session";

const root = createRoot(document.getElementById("root")!);

// VITE_TARGET=wasm builds the fully in-browser app (in-memory mock, no server);
// anything else is the server-backed dashboard. The branch is statically known at
// build time, so the heavy WASM chunk is dropped from the server build entirely.
if (__WASM_TARGET__ === "wasm") {
  void import("./wasm/app/WasmApp").then(({ default: WasmApp }) =>
    root.render(
      <StrictMode>
        <WasmApp />
      </StrictMode>,
    ),
  );
} else {
  // Session-aware embed (the playground): wait for the parent page's
  // postMessage handshake before the first /api/* call, so every request
  // carries X-EDB-Session/X-EDB-Token from the start. Standalone use (CLI,
  // local dev, not inside an iframe) resolves this immediately with null --
  // see session.ts.
  void waitForSessionCreds().then(() =>
    import("./App").then(({ default: App }) =>
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      ),
    ),
  );
}
