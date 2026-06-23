// Unit conversion on read/write, standing in for energydb's pint factors. The
// demo only rescales power (MW <-> GW), but a small dimension table keeps it
// honest: a factor is the ratio of base magnitudes, and conversion across
// dimensions (or unknown units) throws, exactly like pint's IncompatibleUnit.
const DIMENSIONS: Record<string, Record<string, number>> = {
  power: { W: 1, kW: 1e3, MW: 1e6, GW: 1e9 },
  energy: { Wh: 1, kWh: 1e3, MWh: 1e6, GWh: 1e9 },
};

function dimensionOf(unit: string): Record<string, number> | null {
  for (const table of Object.values(DIMENSIONS)) {
    if (unit in table) return table;
  }
  return null;
}

/** Multiplicative factor to convert a value in `from` to `to`. */
export function factor(from: string, to: string): number {
  if (from === to) return 1;
  const a = dimensionOf(from);
  const b = dimensionOf(to);
  if (a && a === b) return a[from] / a[to];
  throw new Error(`cannot convert ${from} to ${to}`);
}
