// UUID7 (time-ordered) for node/edge identity, mirroring energydb's client-side
// identity. run_id mirrors energydb runs.py: the 128-bit uuid7 shifted right by
// 65 bits into a positive signed-63-bit BIGINT (kept time-sortable). BigInt math
// throughout so the >>65 stays exact (JS Number would lose precision).

function bytesToUuid(b: Uint8Array): string {
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function bytesToBigInt(b: Uint8Array): bigint {
  let r = 0n;
  for (const x of b) r = (r << 8n) | BigInt(x);
  return r;
}

/** A fresh UUID7 plus its derived run_id (uuid7 >> 65, as BigInt). */
export function newUuid7(): { id: string; runId: bigint } {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  const ts = BigInt(Date.now()); // 48-bit ms timestamp in the high bytes
  b[0] = Number((ts >> 40n) & 0xffn);
  b[1] = Number((ts >> 32n) & 0xffn);
  b[2] = Number((ts >> 24n) & 0xffn);
  b[3] = Number((ts >> 16n) & 0xffn);
  b[4] = Number((ts >> 8n) & 0xffn);
  b[5] = Number(ts & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70; // version 7
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  return { id: bytesToUuid(b), runId: bytesToBigInt(b) >> 65n };
}

export const uuid7 = (): string => newUuid7().id;
export const newRunId = (): bigint => newUuid7().runId;
