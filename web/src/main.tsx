import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";

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
  void import("./App").then(({ default: App }) =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
}
