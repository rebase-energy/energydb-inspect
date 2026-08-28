// Session-aware bootstrap for the playground deployment: when this dashboard is
// embedded in an iframe (INSPECT_SESSION_AWARE=1 on the backend), the parent
// page owns the one minted playground session and hands its (session_id,
// token) pair to us over postMessage -- never via the URL (query strings leak
// into access logs / Referer headers; see PLAN_PHASE5.md A3). Standalone use
// (the `energydb-inspect` CLI, local dev) is untouched: `window.parent ===
// window` there, so waitForSessionCreds() resolves immediately with null and
// every /api/* fetch goes out with no session headers, exactly as before.

export interface EdbSessionCreds {
  sessionId: string;
  token: string;
}

let creds: EdbSessionCreds | null = null;

export function getSessionCreds(): EdbSessionCreds | null {
  return creds;
}

function isEdbSessionMessage(data: unknown): data is { type: "edb-session"; sessionId: string; token: string } {
  return (
    !!data &&
    typeof data === "object" &&
    (data as any).type === "edb-session" &&
    typeof (data as any).sessionId === "string" &&
    typeof (data as any).token === "string"
  );
}

/** Resolves once with the session creds (or null if not embedded / no reply
 * arrives within `timeoutMs`). Only ever resolves once, so it's safe to await
 * at startup before the first /api/* call. */
export function waitForSessionCreds(timeoutMs = 4000): Promise<EdbSessionCreds | null> {
  return new Promise((resolve) => {
    if (window.parent === window) {
      resolve(null);
      return;
    }
    let done = false;
    const finish = (value: EdbSessionCreds | null) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      resolve(value);
    };
    const onMessage = (event: MessageEvent) => {
      // Same-origin by construction (the parent embeds us under its own
      // origin, e.g. /inspect/ behind the same Caddy edge) -- reject anything
      // else outright rather than trusting an arbitrary embedder.
      if (event.origin !== window.location.origin) return;
      if (isEdbSessionMessage(event.data)) {
        creds = { sessionId: event.data.sessionId, token: event.data.token };
        finish(creds);
      }
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "edb-inspector-ready" }, window.location.origin);
    setTimeout(() => finish(null), timeoutMs);
  });
}
