// TS port of the energydb asset models (the `edb.*` constructors used in the
// notebook). Each builder assigns a client-side UUID7 identity (mirroring the
// real lib, where `model.id` exists before the row is persisted) and shapes the
// `data` JSONB exactly as the Python serializer does: geometry as GeoJSON, plus
// the domain scalars (capacity, hub_height, ...). Series declarations carried on
// a model become rows in `energydb.series` when the node/edge is registered.
import { newUuid7 } from "./uuid7";

export type GeoJSON = Record<string, unknown>;

export const DataType = { ACTUAL: "actual", FORECAST: "forecast" } as const;
export const TimeSeriesType = { FLAT: "FLAT", OVERLAPPING: "OVERLAPPING" } as const;

export interface TsSeries {
  name: string;
  unit: string;
  data_type: string;
  timeseries_type: "FLAT" | "OVERLAPPING";
}

export interface TsModel {
  id: string;
  node_type: string;
  name: string;
  data: Record<string, unknown>;
  timeseries: TsSeries[];
}

export interface TsEdge {
  id: string;
  edge_type: string;
  name: string | null;
  from_id: string;
  to_id: string;
  data: Record<string, unknown>;
  timeseries: TsSeries[];
}

const point = (lat: number, lon: number): GeoJSON => ({ type: "Point", coordinates: [lon, lat] });

function model(
  node_type: string,
  name: string,
  data: Record<string, unknown>,
  timeseries: TsSeries[] = [],
): TsModel {
  return { id: newUuid7().id, node_type, name, data, timeseries };
}

export function TimeSeries(o: {
  name: string;
  unit: string;
  data_type: string;
  timeseries_type?: "FLAT" | "OVERLAPPING";
}): TsSeries {
  return {
    name: o.name,
    unit: o.unit,
    data_type: o.data_type,
    timeseries_type: o.timeseries_type ?? "FLAT",
  };
}

export function Portfolio(o: { name: string }): TsModel {
  return model("Portfolio", o.name, {});
}

export function Site(o: { name: string; geometry: GeoJSON }): TsModel {
  return model("Site", o.name, { geometry: o.geometry });
}

export const wind = {
  WindTurbine(o: {
    name: string;
    capacity: number;
    hub_height: number;
    lat: number;
    lon: number;
    timeseries?: TsSeries[];
  }): TsModel {
    return model(
      "WindTurbine",
      o.name,
      { capacity: o.capacity, hub_height: o.hub_height, geometry: point(o.lat, o.lon) },
      o.timeseries ?? [],
    );
  },
};

export const solar = {
  PVSystem(o: { name: string; lat: number; lon: number; timeseries?: TsSeries[] }): TsModel {
    return model("PVSystem", o.name, { geometry: point(o.lat, o.lon) }, o.timeseries ?? []);
  },
  PVArray(o: {
    name: string;
    capacity: number;
    surface_tilt: number;
    surface_azimuth: number;
    geometry: GeoJSON;
    timeseries?: TsSeries[];
  }): TsModel {
    return model(
      "PVArray",
      o.name,
      {
        capacity: o.capacity,
        surface_tilt: o.surface_tilt,
        surface_azimuth: o.surface_azimuth,
        geometry: o.geometry,
      },
      o.timeseries ?? [],
    );
  },
};

export const battery = {
  Battery(o: {
    name: string;
    storage_capacity: number;
    max_charge: number;
    lat: number;
    lon: number;
    timeseries?: TsSeries[];
  }): TsModel {
    return model(
      "Battery",
      o.name,
      { storage_capacity: o.storage_capacity, max_charge: o.max_charge, geometry: point(o.lat, o.lon) },
      o.timeseries ?? [],
    );
  },
};

export const grid = {
  Line(o: {
    name: string;
    capacity: number;
    from_element: TsModel;
    to_element: TsModel;
    geometry: GeoJSON;
    timeseries?: TsSeries[];
  }): TsEdge {
    return {
      id: newUuid7().id,
      edge_type: "Line",
      name: o.name,
      from_id: o.from_element.id,
      to_id: o.to_element.id,
      data: { capacity: o.capacity, geometry: o.geometry },
      timeseries: o.timeseries ?? [],
    };
  },
};

// A single namespace object so playground steps can read like the Python
// (`edb.Portfolio(...)`, `edb.wind.WindTurbine(...)`, `edb.DataType.ACTUAL`).
export const edb = {
  DataType,
  TimeSeriesType,
  TimeSeries,
  Portfolio,
  Site,
  wind,
  solar,
  battery,
  grid,
};
