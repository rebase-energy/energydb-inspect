/// <reference types="vite/client" />

// Compile-time build target ("wasm" | "server"), injected by vite.config `define`.
declare const __WASM_TARGET__: string;
