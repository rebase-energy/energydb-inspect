"""Realistic, seeded synthetic time series for the demo (not energydb API, just
the numbers the notebook then `.write()`s). 72 hourly points starting 2026-01-01.

- solar  : daytime bell curve with cloud variability, 0 at night
- wind   : smooth random-walk capacity factor (lulls + gusts)
- speed  : wind speed correlated with the wind capacity factor
- battery: daily state-of-charge cycle + the (de)charge power that drives it
- forecast: revisions issued at advancing knowledge_times, each covering a
           bounded horizon window so it clearly starts and ends inside the
           timeline, fanning further from the truth the longer the lead time
"""

from __future__ import annotations

from datetime import UTC, datetime

import numpy as np
import pandas as pd
from shapely.geometry import LineString, Polygon

START = datetime(2026, 1, 1, tzinfo=UTC)
PERIODS = 72

# ── Geometry (lon, lat), real shapes the assets carry, shown on the map ──────
# Areas are polygons; turbines / PV system / battery stay points (passed as
# lat/lon). Children sit inside their parent's area. Both sites are in the Kalmar
# Sound region of southeast Sweden, ~16 km apart.
#
# Offshore wind farm in the Øresund: a compact lease-area polygon around the two
# turbines (T01 12.91331, T02 12.900, same latitude 55.78726).
OFFSHORE_AREA = Polygon(
    [(12.893, 55.783), (12.920, 55.783), (12.920, 55.792), (12.893, 55.792)]
)
# A second, similar-size wind farm a bit north, with a single turbine (T03 12.905/55.805).
OFFSHORE2_AREA = Polygon(
    [(12.892, 55.800), (12.919, 55.800), (12.919, 55.810), (12.892, 55.810)]
)
# Solar farm just east of the wind farm (centred on 12.94151/55.77887): the site
# boundary and, inside it, the rectangular footprint of the PV array.
SOLAR_FARM_AREA = Polygon(
    [(12.937, 55.7765), (12.946, 55.7765), (12.946, 55.7815), (12.937, 55.7815)]
)
PV_ARRAY_AREA = Polygon(
    [(12.9405, 55.7783), (12.9445, 55.7783), (12.9445, 55.7798), (12.9405, 55.7798)]
)
# DC link from the PV system (PV01 12.94151/55.77887) to the battery (B01 12.9435/55.7805).
SOLAR_CABLE = LineString([(12.94151, 55.77887), (12.9435, 55.7805)])


def _hours() -> pd.DatetimeIndex:
    return pd.date_range(START, periods=PERIODS, freq="1h")


def _frame(values: np.ndarray) -> pd.DataFrame:
    return pd.DataFrame({"valid_time": _hours(), "value": np.round(values, 3)})


def _hour_of_day() -> np.ndarray:
    return np.arange(PERIODS) % 24


def _wind_cf(seed: int = 2) -> np.ndarray:
    """Smooth capacity factor in [0, 1] via a mean-reverting random walk.

    High persistence + small steps keep the curve gentle (slow lulls and
    gusts) rather than jittery.
    """
    rng = np.random.default_rng(seed)
    cf = np.empty(PERIODS)
    cf[0] = 0.5
    for i in range(1, PERIODS):
        cf[i] = np.clip(0.92 * cf[i - 1] + 0.08 * 0.5 + rng.normal(0, 0.025), 0.0, 1.0)
    return cf


def wind_power(capacity: float = 3.5, seed: int = 2) -> pd.DataFrame:
    return _frame(capacity * _wind_cf(seed))


def wind_speed(seed: int = 2) -> pd.DataFrame:
    # m/s loosely implied by the capacity factor (cube-root-ish of a power curve)
    return _frame(3.0 + 9.0 * np.cbrt(_wind_cf(seed)))


def solar_power(capacity: float = 10.0, seed: int = 1) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    hod = _hour_of_day()
    bell = np.clip(np.sin(np.pi * (hod - 6) / 12), 0, None)  # up ~06:00, down ~18:00
    clouds = 0.8 + 0.2 * rng.random(PERIODS)
    return _frame(np.clip(capacity * bell * clouds, 0, capacity))


def battery_soc(seed: int = 3) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    hod = _hour_of_day()
    soc = 55 + 30 * np.sin(2 * np.pi * (hod - 15) / 24)  # charged by afternoon
    return _frame(np.clip(soc + rng.normal(0, 1.5, PERIODS), 5, 99))


def battery_power(seed: int = 3) -> pd.DataFrame:
    soc = battery_soc(seed)["value"].to_numpy()
    delta = np.diff(soc, prepend=soc[0])  # +charging / -discharging
    return _frame(delta * 5.0)  # %/h → MW (illustrative)


def cable_flow() -> pd.DataFrame:
    """Power across the PV-to-battery DC link: the battery's (de)charge power
    (positive while charging from the array, negative while discharging)."""
    return _frame(battery_power()["value"].to_numpy())


# Forecast revisions: (hours after START the forecast is issued, error scale).
# Six revisions issued every 8 h, each sharper than the last. Each covers a
# bounded FORECAST_HORIZON_H window from its issue time, so it starts and ends
# *inside* the 72 h timeline, making each revision's span easy to read.
FORECAST_HORIZON_H = 36
FORECAST_REVISIONS = [
    (0, 0.34),
    (8, 0.27),
    (16, 0.20),
    (24, 0.14),
    (32, 0.09),
    (40, 0.05),
]


def wind_power_forecast(
    capacity: float = 3.5,
    seed: int = 2,
    *,
    issued_at_h: int = 0,
    error: float = 0.15,
    horizon_h: int = FORECAST_HORIZON_H,
) -> pd.DataFrame:
    """A wind-power forecast issued ``issued_at_h`` hours after START.

    Covers a bounded ``horizon_h``-hour window from the issue time, so the
    revision clearly *starts* (peeling off the actual where it is issued) and
    *ends* (its horizon runs out) within the displayed timeline rather than
    running to the edge. It fans away from the truth smoothly as lead time
    grows, diverging most at the far end of the horizon. A smaller ``error``
    gives a later, sharper revision.
    """
    truth = capacity * _wind_cf(seed)
    end = min(issued_at_h + horizon_h, PERIODS)
    idx = np.arange(issued_at_h, end)
    lead = idx - issued_at_h
    growth = lead / max(horizon_h, 1)  # 0 at issue → 1 at the far end of the horizon
    # One slow, smooth departure wave (few wiggles) whose amplitude grows with
    # lead time; a per-issue phase/sign so the revisions look distinct.
    rng = np.random.default_rng(200 + issued_at_h)
    phase = rng.uniform(0, 2 * np.pi)
    sign = 1.0 if rng.random() < 0.5 else -1.0
    wave = np.sin(2 * np.pi * lead / 52.0 + phase)
    dev = sign * error * growth * wave
    fc = np.clip(truth[idx] + capacity * dev, 0, capacity)
    return pd.DataFrame({"valid_time": _hours()[idx], "value": np.round(fc, 3)})
