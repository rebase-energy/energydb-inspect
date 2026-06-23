// The guided playground, ported from notebooks/demo.py. Each step shows the real
// energydb Python and a `run` that performs the same thing through the in-browser
// mock client. Steps build on each other; shared handles live in a closure that
// Restart rebuilds. `ctx` lets a step refresh + pause mid-run so multi-node adds
// animate one by one.
import { edb } from "../edb/models";
import type { TsModel } from "../edb/models";
import type { MockClient } from "../mock/client";
import type { ReadFrame } from "../mock/store";
import * as dd from "./demoData";

export interface StepCtx {
  refresh: () => void;
  pause: (ms?: number) => Promise<void>;
}

/** A series the dashboard should select when this step becomes active. */
export interface StepFocus {
  path: string;
  data_type: string;
  name: string;
}

export interface ResultChart {
  series: { name: string; data: [number, number][] }[];
  unit: string;
}
export interface ResultTable {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
}
/** Structured step output: a mini chart and/or a small table, with a caption. */
export interface StepResult {
  text?: string;
  chart?: ResultChart;
  table?: ResultTable;
}
export type StepOut = string | StepResult | void;

export interface Step {
  id: string;
  title: string;
  prompt: string; // chat-style instruction shown as the step's "ask"
  blurb: string;
  python: string;
  focus?: StepFocus;
  view?: "tree" | "map" | "plot"; // mobile: which dashboard tab to show while this step is active
  run: (ctx: StepCtx) => Promise<StepOut>;
}

const P = "Nordic";

const toMs = (s: unknown): number => new Date(`${s}Z`).getTime();
const shortPath = (path: string): string => path.split("/").slice(-2).join("/");
const ktShort = (s: string): string => s.slice(5, 16).replace("T", " "); // 2026-01-01T00:00:00 → 01-01 00:00

interface FrameOpts {
  text?: string;
  groupBy?: string; // column whose distinct values become chart lines (default "path")
  label?: (v: string) => string;
}

/** Turn a read frame into a mini chart (one line per group) + a small table. */
function frameToResult(frame: ReadFrame, opts: FrameOpts = {}): StepResult {
  const gi = frame.columns.indexOf(opts.groupBy ?? "path");
  const vi = frame.columns.indexOf("valid_time");
  const xi = frame.columns.indexOf("value");
  const label = opts.label ?? shortPath;
  const byName = new Map<string, [number, number][]>();
  for (const r of frame.rows) {
    const name = gi >= 0 ? label(String(r[gi])) : "value";
    const arr = byName.get(name) ?? [];
    arr.push([toMs(r[vi]), Number(r[xi])]);
    byName.set(name, arr);
  }
  const series = [...byName.entries()].map(([name, data]) => ({ name, data: data.sort((a, b) => a[0] - b[0]) }));
  return {
    text: opts.text,
    chart: { series, unit: "MW" },
    table: { columns: frame.columns, rows: frame.rows.slice(0, 6), rowCount: frame.rows.length },
  };
}

export function buildSteps(client: MockClient): Step[] {
  const h: {
    portfolio?: TsModel;
    offshore?: ReturnType<MockClient["get_node"]>;
    t01?: TsModel;
    t02?: TsModel;
    offshore2?: ReturnType<MockClient["get_node"]>;
    t03?: TsModel;
    solar?: ReturnType<MockClient["get_node"]>;
    pv?: ReturnType<MockClient["get_node"]>;
    array?: TsModel;
  } = {};

  return [
    {
      id: "portfolio",
      title: "Connect and create the portfolio",
      prompt: "Connect and create the portfolio.",
      blurb: "Structure lives in Postgres, values in ClickHouse. Every tree hangs off a portfolio root.",
      python: `import energydb as edb

client = edb.Client()
client.create()

portfolio = edb.Portfolio(name="Nordic")
client.register_tree(portfolio)`,
      run: async () => {
        await client.create();
        h.portfolio = edb.Portfolio({ name: P });
        await client.register_tree(h.portfolio);
      },
    },
    {
      id: "offshore-1",
      title: "A site",
      prompt: "Add our first site.",
      blurb: "add() returns a scope at the new node, so you can grow the tree from it.",
      python: `offshore = client.get_node("Nordic").add(
    edb.Site(name="Offshore-1")
)`,
      run: async () => {
        h.offshore = await client.get_node(P).add(edb.Site({ name: "Offshore-1", geometry: dd.OFFSHORE_AREA }));
      },
    },
    {
      id: "t01",
      title: "A wind turbine",
      prompt: "Add turbine T01.",
      blurb: "Three series declared up front (no data yet): power, wind speed, and a power forecast.",
      python: `t01 = edb.wind.WindTurbine(
    name="T01", capacity=3.5,
    timeseries=[
        edb.TimeSeries("power", "MW"),
        edb.TimeSeries("wind_speed", "m/s"),
        edb.TimeSeries("power", "MW", forecast=True),
    ],
)
offshore.add(t01)`,
      run: async () => {
        h.t01 = edb.wind.WindTurbine({
          name: "T01",
          capacity: 3.5,
          hub_height: 80,
          lat: 55.78726,
          lon: 12.91331,
          timeseries: [
            edb.TimeSeries({ name: "power", unit: "MW", data_type: edb.DataType.ACTUAL }),
            edb.TimeSeries({ name: "wind_speed", unit: "m/s", data_type: edb.DataType.ACTUAL }),
            edb.TimeSeries({
              name: "power",
              unit: "MW",
              data_type: edb.DataType.FORECAST,
              timeseries_type: edb.TimeSeriesType.OVERLAPPING,
            }),
          ],
        });
        await h.offshore!.add(h.t01);
      },
    },
    {
      id: "t02",
      title: "A second turbine",
      prompt: "Add a second turbine.",
      blurb: "Same site, one power series.",
      python: `t02 = edb.wind.WindTurbine(
    name="T02", capacity=3.5,
    timeseries=[edb.TimeSeries("power", "MW")],
)
offshore.add(t02)`,
      run: async () => {
        h.t02 = edb.wind.WindTurbine({
          name: "T02",
          capacity: 3.5,
          hub_height: 80,
          lat: 55.78726,
          lon: 12.9,
          timeseries: [edb.TimeSeries({ name: "power", unit: "MW", data_type: edb.DataType.ACTUAL })],
        });
        await h.offshore!.add(h.t02);
      },
    },
    {
      id: "offshore-2",
      title: "A second wind farm",
      prompt: "Add a second wind farm.",
      blurb: "A smaller farm with one turbine. Each node pops into the tree as it is added.",
      python: `offshore2 = client.get_node("Nordic").add(
    edb.Site(name="Offshore-2")
)
offshore2.add(
    edb.wind.WindTurbine(
        name="T03", capacity=3.5,
        timeseries=[edb.TimeSeries("power", "MW")],
    )
)`,
      run: async (ctx) => {
        h.offshore2 = await client.get_node(P).add(edb.Site({ name: "Offshore-2", geometry: dd.OFFSHORE2_AREA }));
        ctx.refresh();
        await ctx.pause();
        h.t03 = edb.wind.WindTurbine({
          name: "T03",
          capacity: 3.5,
          hub_height: 80,
          lat: 55.805,
          lon: 12.905,
          timeseries: [edb.TimeSeries({ name: "power", unit: "MW", data_type: edb.DataType.ACTUAL })],
        });
        await h.offshore2.add(h.t03);
      },
    },
    {
      id: "solar",
      title: "A solar farm",
      prompt: "Add a solar farm with a battery.",
      blurb: "A PV array and a battery, linked by a DC cable so storage and generation are wired together.",
      view: "map",
      python: `solar = client.get_node("Nordic").add(
    edb.Site(name="Solar-Farm-1")
)
pv = solar.add(edb.solar.PVSystem(name="PV01"))
pv.add(edb.solar.PVArray(name="Array-1", capacity=10))

battery = edb.battery.Battery(name="B01")
solar.add(battery)

# wire the battery to the PV system
client.create_edge(
    edb.grid.Line(name="Cable", from_element=pv, to_element=battery)
)`,
      run: async (ctx) => {
        h.solar = await client.get_node(P).add(edb.Site({ name: "Solar-Farm-1", geometry: dd.SOLAR_FARM_AREA }));
        ctx.refresh();
        await ctx.pause();
        const pvSystem = edb.solar.PVSystem({ name: "PV01", lat: 55.77887, lon: 12.94151 });
        h.pv = await h.solar.add(pvSystem);
        ctx.refresh();
        await ctx.pause();
        h.array = edb.solar.PVArray({
          name: "Array-1",
          capacity: 10,
          surface_tilt: 25,
          surface_azimuth: 180,
          geometry: dd.PV_ARRAY_AREA,
          timeseries: [edb.TimeSeries({ name: "power", unit: "MW", data_type: edb.DataType.ACTUAL })],
        });
        await h.pv.add(h.array);
        ctx.refresh();
        await ctx.pause();
        const b01 = edb.battery.Battery({
          name: "B01",
          storage_capacity: 1000,
          max_charge: 500,
          lat: 55.7805,
          lon: 12.9435,
          timeseries: [
            edb.TimeSeries({ name: "power", unit: "MW", data_type: edb.DataType.ACTUAL }),
            edb.TimeSeries({ name: "soc", unit: "%", data_type: edb.DataType.ACTUAL }),
          ],
        });
        await h.solar.add(b01);
        ctx.refresh();
        await ctx.pause();
        await client.create_edge(
          edb.grid.Line({
            name: "Cable",
            capacity: 250,
            from_element: pvSystem,
            to_element: b01,
            geometry: dd.SOLAR_CABLE,
          }),
        );
      },
    },
    {
      id: "write-actuals",
      title: "Write actuals",
      prompt: "Write 72h of actuals.",
      blurb: "72 hours of hourly values, one call per series. Click a green badge to plot it.",
      python: `P = "Nordic"
client.get_node(P, "Offshore-1", "T01").write(
    dd.wind_power(3.5), name="power", data_type="actual"
)
client.get_node(P, "Offshore-1", "T01").write(
    dd.wind_speed(), name="wind_speed", data_type="actual"
)
# … and the same for T02, T03, the PV array and the battery`,
      run: async () => {
        await client.get_node(P, "Offshore-1", "T01").write(dd.windPower(3.5, 2), { name: "power", data_type: "actual" });
        await client.get_node(P, "Offshore-1", "T01").write(dd.windSpeed(), { name: "wind_speed", data_type: "actual" });
        await client.get_node(P, "Offshore-1", "T02").write(dd.windPower(3.5, 5), { name: "power", data_type: "actual" });
        await client.get_node(P, "Offshore-2", "T03").write(dd.windPower(3.5, 7), { name: "power", data_type: "actual" });
        await client.get_node(P, "Solar-Farm-1", "PV01", "Array-1").write(dd.solarPower(10, 1), { name: "power", data_type: "actual" });
        await client.get_node(P, "Solar-Farm-1", "B01").write(dd.batteryPower(), { name: "power", data_type: "actual" });
        await client.get_node(P, "Solar-Farm-1", "B01").write(dd.batterySoc(), { name: "soc", data_type: "actual" });
        return "7 series, 72 hourly points each";
      },
    },
    {
      id: "forecasts",
      title: "Forecasts",
      prompt: "Forecast T01's power, revised over time.",
      blurb:
        "The same series forecast repeatedly as the issue time advances; later issues hug the truth. Switch to All revisions on the plot.",
      focus: { path: `${P}/Offshore-1/T01`, data_type: "forecast", name: "power" },
      python: `fc = client.get_node("Nordic", "Offshore-1", "T01")
for issued_at_h, error in dd.FORECAST_REVISIONS:
    fc.write(
        dd.wind_power_forecast(
            3.5, issued_at_h=issued_at_h, error=error
        ),
        name="power", data_type="forecast",
        knowledge_time=dd.START + timedelta(hours=issued_at_h),
    )`,
      run: async (ctx) => {
        // Add each revision individually so it pops into the plot one at a time.
        for (const [issued, error] of dd.FORECAST_REVISIONS) {
          await client
            .get_node(P, "Offshore-1", "T01")
            .write(dd.windPowerForecast(3.5, issued, error), {
              name: "power",
              data_type: "forecast",
              knowledge_time: dd.isoHour(issued),
            });
          ctx.refresh();
          await ctx.pause(420);
        }
        return `${dd.FORECAST_REVISIONS.length} revisions written (toggle All revisions on the plot)`;
      },
    },
    {
      id: "read",
      title: "Read it back",
      prompt: "Read the power back.",
      blurb:
        "One call fans out over the subtree, keyed by path; narrow to one series and it is just valid_time + value. Ask for GW and it rescales.",
      python: `# fan out over the whole portfolio, keyed by path
client.get_node("Nordic").read(data_type="actual", name="power")

# one series: the identity columns drop away
t01 = client.get_node("Nordic", "Offshore-1", "T01")
t01.read(data_type="actual", name="power")

# ask for another unit and it rescales
t01.read(data_type="actual", name="power", unit="GW")`,
      run: async () => {
        const fan = await client.get_node(P).read({ data_type: "actual", name: "power" });
        const n = new Set(fan.rows.map((r) => String(r[0]))).size;
        return frameToResult(fan, { text: `${n} power series across the portfolio · pass unit="GW" to rescale` });
      },
    },
    {
      id: "as-of",
      title: "Read the past (as-of)",
      prompt: "Look at past forecast revisions.",
      blurb: "Every revision is kept, stamped with the knowledge_time it was issued at.",
      python: `t01 = client.get_node("Nordic", "Offshore-1", "T01")

# every revision, stamped with its knowledge_time
t01.read(data_type="forecast", name="power", include_knowledge_time=True)`,
      run: async () => {
        const t01 = client.get_node(P, "Offshore-1", "T01");
        const all = await t01.read({ data_type: "forecast", name: "power", include_knowledge_time: true });
        const revs = new Set(all.rows.map((r) => String(r[all.columns.indexOf("knowledge_time")]))).size;
        return frameToResult(all, {
          groupBy: "knowledge_time",
          label: ktShort,
          text: `${revs} revisions, each stamped with the knowledge_time it was issued at`,
        });
      },
    },
    {
      id: "navigate",
      title: "Navigate and filter",
      prompt: "Filter to just the turbines.",
      blurb: "where(type=...) filters the subtree by type before the read.",
      python: `client.get_node("Nordic").where(type="WindTurbine").read(
    data_type="actual", name="power"
)`,
      run: async () => {
        const turb = await client.get_node(P).where({ type: "WindTurbine" }).read({ data_type: "actual", name: "power" });
        const n = new Set(turb.rows.map((r) => String(r[0]))).size;
        return frameToResult(turb, { text: `${n} wind turbines matched` });
      },
    },
    {
      id: "edit",
      title: "Edit the hierarchy",
      prompt: "Move T03 to Offshore-1.",
      blurb: "Move a node and edit its data in one atomic transaction; dry_run previews first.",
      view: "tree",
      python: `# preview the deletion without touching anything
client.get_node("Nordic", "Offshore-2", "T03").delete(
    dry_run=True
).render()

# one atomic transaction: relocate the turbine, tag both sites
with client.transaction() as txn:
    txn.get_node(P, "Offshore-2", "T03").move_to(f"{P}/Offshore-1")
    txn.get_node(P, "Offshore-1").update({"note": "now hosts T03"})
    txn.get_node(P, "Offshore-2").update({"status": "retired"})
    txn.preview().render()
    txn.commit()`,
      run: async (ctx) => {
        const preview = (await client.get_node(P, "Offshore-2", "T03").delete({ dry_run: true })).render();
        const txn = await client.transaction();
        try {
          await txn.get_node(P, "Offshore-2", "T03").move_to(`${P}/Offshore-1`);
          ctx.refresh();
          await ctx.pause(1100); // let the move animate so it is easy to follow
          await txn.get_node(P, "Offshore-1").update({ note: "now hosts T03" });
          ctx.refresh();
          await ctx.pause(600);
          await txn.get_node(P, "Offshore-2").update({ status: "retired" });
          const diff = txn.preview().render();
          await txn.commit();
          return `dry-run delete:\n${preview}\n\ntransaction preview:\n${diff}`;
        } catch (e) {
          await txn.rollback();
          throw e;
        }
      },
    },
  ];
}
