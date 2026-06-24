import marimo

__generated_with = "0.23.9"
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo

    return (mo,)


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    # energydb

    A guided tour: build a portfolio, write timeseries, then read it back. Structure lives in
    **Postgres**, values in **ClickHouse**. Click **Reset DB** in the inspector, then run these cells
    top to bottom and watch the tree, map and plots fill in live in the other window.

    Two flags describe a series: `data_type` is what the values *mean* (actual, forecast);
    `timeseries_type` is how they are *stored*. FLAT keeps one value per timestamp, OVERLAPPING
    keeps every forecast revision.

    (Lazy mode: running a cell marks the ones below it stale instead of re-running them, so the tree
    builds step by step.)
    """)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## Connect and create the portfolio

    Structure lives in Postgres, values in ClickHouse. Every tree hangs off a portfolio root.
    """)
    return


@app.cell
def _():
    from dotenv import load_dotenv

    load_dotenv()  # TIMEDB_PG_DSN / TIMEDB_CH_URL from a .env in the cwd

    import energydb as edb

    from energydb_inspect import demo_data as dd

    P = "Nordic"
    client = edb.Client()
    client.create()  # ensure the schema exists

    portfolio = edb.Portfolio(name=P)
    client.register_tree(portfolio)
    return P, client, dd, edb, portfolio


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## A site

    `.add()` returns a scope at the new node, so you can grow the tree from it. The site carries a
    real polygon footprint (an Øresund lease area); geometry is a shapely shape that energydb stores
    as GeoJSON and the map renders.
    """)
    return


@app.cell
def _(client, dd, edb, portfolio):
    offshore = client.get_node(portfolio.name).add(
        edb.Site(name="Offshore-1", geometry=dd.OFFSHORE_AREA)
    )
    return (offshore,)


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## A wind turbine

    Three series declared up front (metadata only, no data yet): power, wind speed, and an
    OVERLAPPING power forecast.
    """)
    return


@app.cell
def _(edb, offshore):
    t01 = edb.wind.WindTurbine(
        name="T01",
        capacity=3.5,
        hub_height=80,
        lat=55.78726,
        lon=12.91331,
        timeseries=[
            edb.TimeSeries(name="power", unit="MW", data_type=edb.DataType.ACTUAL),
            edb.TimeSeries(
                name="wind_speed", unit="m/s", data_type=edb.DataType.ACTUAL
            ),
            edb.TimeSeries(
                name="power",
                unit="MW",
                data_type=edb.DataType.FORECAST,
                timeseries_type=edb.TimeSeriesType.OVERLAPPING,
            ),
        ],
    )
    offshore.add(t01)
    return (t01,)


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## A second turbine

    Same site, one power series.
    """)
    return


@app.cell
def _(edb, offshore):
    t02 = edb.wind.WindTurbine(
        name="T02",
        capacity=3.5,
        hub_height=80,
        lat=55.78726,
        lon=12.900,
        timeseries=[
            edb.TimeSeries(name="power", unit="MW", data_type=edb.DataType.ACTUAL)
        ],
    )
    offshore.add(t02)
    return (t02,)


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## A second wind farm

    A smaller farm a bit north with one turbine. Each node pops into the tree as it is added.
    """)
    return


@app.cell
def _(client, dd, edb, portfolio):
    offshore2 = client.get_node(portfolio.name).add(
        edb.Site(name="Offshore-2", geometry=dd.OFFSHORE2_AREA)
    )
    return (offshore2,)


@app.cell
def _(edb, offshore2):
    t03 = edb.wind.WindTurbine(
        name="T03",
        capacity=3.5,
        hub_height=80,
        lat=55.805,
        lon=12.905,
        timeseries=[
            edb.TimeSeries(name="power", unit="MW", data_type=edb.DataType.ACTUAL)
        ],
    )
    offshore2.add(t03)
    return (t03,)


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## A solar farm

    A PV array and a battery, linked by a DC cable so storage and generation are wired together.
    Edges carry geometry too: the cable is a LineString from the PV system to the battery.
    """)
    return


@app.cell
def _(client, dd, edb, portfolio):
    solar_farm = client.get_node(portfolio.name).add(
        edb.Site(name="Solar-Farm-1", geometry=dd.SOLAR_FARM_AREA)
    )
    return (solar_farm,)


@app.cell
def _(edb, solar_farm):
    pv_system = edb.solar.PVSystem(name="PV01", lat=55.77887, lon=12.94151)
    pv = solar_farm.add(pv_system)
    return pv, pv_system


@app.cell
def _(dd, edb, pv):
    # The PV array's footprint is a polygon (the rectangular panel field).
    array = edb.solar.PVArray(
        name="Array-1",
        capacity=10,
        surface_tilt=25,
        surface_azimuth=180,
        geometry=dd.PV_ARRAY_AREA,
        timeseries=[
            edb.TimeSeries(name="power", unit="MW", data_type=edb.DataType.ACTUAL)
        ],
    )
    pv.add(array)
    return (array,)


@app.cell
def _(edb, solar_farm):
    battery = edb.battery.Battery(
        name="B01",
        storage_capacity=1000,
        max_charge=500,
        lat=55.7805,
        lon=12.9435,
        timeseries=[
            edb.TimeSeries(name="power", unit="MW", data_type=edb.DataType.ACTUAL),
            edb.TimeSeries(name="soc", unit="%", data_type=edb.DataType.ACTUAL),
        ],
    )
    solar_farm.add(battery)
    return (battery,)


@app.cell
def _(battery, client, dd, edb, pv_system):
    client.create_edge(
        edb.grid.Line(
            name="Cable",
            capacity=250,
            from_element=pv_system,
            to_element=battery,
            geometry=dd.SOLAR_CABLE,
        )
    )
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## Write actuals

    72 hours of hourly values, one call per series. The dataframe is just `valid_time` + `value`;
    energydb routes it to the right ClickHouse series. Select a series in the inspector to plot it.
    """)
    return


@app.cell
def _(P, array, battery, client, dd, t01, t02, t03):
    client.get_node(P, "Offshore-1", "T01").write(
        dd.wind_power(t01.capacity), name="power", data_type="actual"
    )
    client.get_node(P, "Offshore-1", "T01").write(
        dd.wind_speed(), name="wind_speed", data_type="actual"
    )
    client.get_node(P, "Offshore-1", "T02").write(
        dd.wind_power(t02.capacity, seed=5), name="power", data_type="actual"
    )
    client.get_node(P, "Offshore-2", "T03").write(
        dd.wind_power(t03.capacity, seed=7), name="power", data_type="actual"
    )
    client.get_node(P, "Solar-Farm-1", "PV01", "Array-1").write(
        dd.solar_power(array.capacity), name="power", data_type="actual"
    )
    client.get_node(P, "Solar-Farm-1", battery.name).write(
        dd.battery_power(), name="power", data_type="actual"
    )
    client.get_node(P, "Solar-Farm-1", battery.name).write(
        dd.battery_soc(), name="soc", data_type="actual"
    )
    wrote = True
    return (wrote,)


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## or write in bulk, no `get_node()`

    `client.write()` takes a routing manifest: the same data plus `path`, `data_type` and `name`
    columns. One call can fan out across many series at once.
    """)
    return


@app.cell
def _(P, client, dd, wrote):
    import polars as _pl

    wrote
    _manifest = _pl.from_pandas(dd.wind_speed()).with_columns(
        _pl.lit(f"{P}/Offshore-1/T01").alias("path"),
        _pl.lit("actual").alias("data_type"),
        _pl.lit("wind_speed").alias("name"),
    )
    client.write(_manifest)
    _manifest.head()
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## Forecasts, revised as you learn

    The same series forecast repeatedly as the issue time advances. Each revision has a later
    `knowledge_time` and a bounded horizon, so it peels off the actual where it is issued and the
    later issues hug the truth. They are written one at a time, so in the inspector you can select
    the forecast series, switch to **All revisions**, and watch each issue land.
    """)
    return


@app.cell
def _(P, client, dd, t01, wrote):
    from datetime import timedelta

    wrote
    fc = client.get_node(P, "Offshore-1", "T01")
    for issued_at_h, error in dd.FORECAST_REVISIONS:
        fc.write(
            dd.wind_power_forecast(t01.capacity, issued_at_h=issued_at_h, error=error),
            name="power",
            data_type="forecast",
            knowledge_time=dd.START + timedelta(hours=issued_at_h),
        )
    forecast_written = wrote
    return (forecast_written,)


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## Read it back

    One call fans out over the whole subtree (a single indexed query, any depth) and returns a tidy
    frame keyed by `path`. Narrow to one series and the identity columns drop away.
    """)
    return


@app.cell
def _(P, client, forecast_written):
    # Whole-portfolio fan-out: every `power` actual under the portfolio, in one frame.
    forecast_written
    client.get_node(P).read(data_type="actual", name="power")
    return


@app.cell
def _(P, client, forecast_written):
    # A single series: identity columns (path/data_type/name) are stripped.
    forecast_written
    client.get_node(P, "Offshore-1", "T01").read(data_type="actual", name="power")
    return


@app.cell
def _(P, client, forecast_written):
    # output="by_path" returns a dict keyed by SeriesKey(path, data_type, name).
    forecast_written
    client.get_node(P).read(data_type="actual", name="power", output="by_path")
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## Units convert on read

    `power` is stored in its canonical unit (MW). Ask for another unit and pint rescales it for you.
    Here MW to GW (a factor of 1000). `write(..., unit=...)` converts on the way in too.
    """)
    return


@app.cell
def _(P, client, forecast_written):
    import polars as _pl

    forecast_written
    _t01 = client.get_node(P, "Offshore-1", "T01")
    _mw = _t01.read(data_type="actual", name="power")
    _gw = _t01.read(data_type="actual", name="power", unit="GW")
    _pl.DataFrame(
        {
            "valid_time": _mw["valid_time"],
            "power_MW": _mw["value"],
            "power_GW": _gw["value"],
        }
    ).head(6)
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## Read the past (as-of)

    Every revision is kept, stamped with the `knowledge_time` it was issued at.
    `include_knowledge_time=True` surfaces that dimension; `end_known=` reads the series as it was
    known at a past instant, so you only see the revisions issued by then. This is what powers
    backtests without look-ahead bias.
    """)
    return


@app.cell
def _(P, client, forecast_written):
    # All revisions at once: the same valid_times, stacked by knowledge_time.
    forecast_written
    client.get_node(P, "Offshore-1", "T01").read(
        data_type="forecast", name="power", include_knowledge_time=True
    )
    return


@app.cell
def _(P, client, dd, forecast_written):
    import datetime as _dt

    _t01 = client.get_node(P, "Offshore-1", "T01")

    def _known_at(hours):
        _df = _t01.read(
            data_type="forecast",
            name="power",
            end_known=dd.START + _dt.timedelta(hours=hours),
            include_knowledge_time=True,
        )
        return _df["knowledge_time"].unique().sort().to_list()

    forecast_written
    # Known just after issue 1 (h=0) vs. after issue 2 (h=12): the as-of view grows.
    {"as_of_+1h": _known_at(1), "as_of_+13h": _known_at(13)}
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## Navigate and filter

    `.where(type=...)` filters a subtree by type before the read, addressed by name and type, never
    by UUID.
    """)
    return


@app.cell
def _(P, client, forecast_written):
    # Power for turbines only, across the whole portfolio.
    forecast_written
    client.get_node(P).where(type="WindTurbine").read(data_type="actual", name="power")
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## Edit the hierarchy

    Identity is a stable UUID, so renames and moves are plain `UPDATE`s and series stay attached.
    `dry_run=True` returns a `TreeDiff` you can inspect before touching anything. A transaction
    batches several edits into one commit. Watch the turbine move between sites in the tree.
    """)
    return


@app.cell
def _(P, client, forecast_written):
    # dry_run previews the change and touches nothing. render() writes the diff
    # straight to stdout (it returns None), so there is nothing to print, just call it.
    forecast_written
    client.get_node(P, "Offshore-2", "T03").delete(dry_run=True).render()
    return


@app.cell
def _(P, client, forecast_written):
    forecast_written
    # One atomic transaction: relocate the lone turbine to the bigger site and tag
    # both sites. Each node is touched exactly once (the move on T03, a note on
    # Offshore-1, a status on Offshore-2), so all three show in the preview.
    with client.transaction() as _txn:
        _txn.get_node(P, "Offshore-2", "T03").move_to(f"{P}/Offshore-1")
        _txn.get_node(P, "Offshore-1").update({"note": "now hosts T03"})
        _txn.get_node(P, "Offshore-2").update({"status": "retired"})
        _txn.preview().render()  # prints the tree-diff to stdout
        _txn.commit()
    edited = True
    return (edited,)


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## edges hold series too

    Topology is not just lines on a map. An edge owns series like any node. Attach a `power_flow`
    series to the PV-to-battery DC link, write it, read it back. It is clickable in the inspector.
    """)
    return


@app.cell
def _(P, client, dd, edb, forecast_written):
    forecast_written
    _cable = client.get_edge(
        f"{P}/Solar-Farm-1/PV01",
        f"{P}/Solar-Farm-1/B01",
        type="Line",
    )
    _cable.register_series(
        name="power_flow",
        canonical_unit="MW",
        data_type="actual",
        timeseries_type=edb.TimeSeriesType.FLAT,
    )
    _cable.write(dd.cable_flow(), name="power_flow", data_type="actual")
    _cable.read(data_type="actual", name="power_flow")
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## provenance: who wrote this?

    Every `write()` opens a *run* and stamps its `run_id` on every row. Tag the run with
    `workflow_id`, `model_name`, and a free-form `run_params` dict; `write()` hands the `run_id`
    back. Listing the runs behind a series still needs its `series_id`, and today the only handle
    to that is the idempotent `register_series` (see "what's next").
    """)
    return


@app.cell
def _(P, client, dd, edb, forecast_written):
    forecast_written
    _t01 = client.get_node(P, "Offshore-1", "T01")
    # workflow_id / model_name are dedicated columns; run_params is free-form JSON.
    _run_id = _t01.write(
        dd.wind_power(3.5),
        name="power",
        data_type="actual",
        workflow_id="scada-ingest",
        model_name="raw-v1",
        run_params={"source": "scada", "interval": "1h"},
    )
    # register_series is idempotent; here it is only a (clumsy) way to recover the
    # series_id so read_runs_for_series can list the runs behind this series.
    _sid = _t01.register_series(
        name="power",
        canonical_unit="MW",
        data_type="actual",
        timeseries_type=edb.TimeSeriesType.FLAT,
    )
    {"run_id": _run_id, "runs": client.read_runs_for_series(series_id=_sid)}
    return


@app.cell(hide_code=True)
def _(mo):
    mo.md("""
    ## rebuild the tree as objects

    Pull the whole portfolio back from the database as live EnergyDataModel objects, each node's
    series re-attached (`include_series=True`).
    """)
    return


@app.cell
def _(P, client, edited):
    edited
    client.get_tree(P, include_series=True)
    return


if __name__ == "__main__":
    app.run()
