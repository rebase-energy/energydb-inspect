// A mock energydb client with the same surface the playground steps use,
// backed by the in-memory MockStore. Mutations apply immediately (no real
// transaction), which is all the demo needs: dry_run builds a TreeDiff without
// touching the store, and a committed transaction applies as it goes. Reads
// compute real sample frames from the in-memory points.
import type { Point } from "../demo/demoData";
import { TreeDiff, type NodeChange } from "../edb/diff";
import type { TsEdge, TsModel } from "../edb/models";
import type { MockStore, ReadFrame, ReadOpts } from "./store";

export interface WriteOpts {
  name: string;
  data_type: string;
  knowledge_time?: string;
  workflow_id?: string;
  model_name?: string;
  run_params?: Record<string, unknown>;
}

export interface ReadArgs extends ReadOpts {
  data_type: string;
  name: string;
}

const nowIso = (): string => new Date().toISOString().slice(0, 19);

export class MockScope {
  constructor(
    private readonly store: MockStore,
    readonly path: string,
    private readonly whereType?: string,
  ) {}

  where(opts: { type: string }): MockScope {
    return new MockScope(this.store, this.path, opts.type);
  }

  async add(node: TsModel): Promise<MockScope> {
    const parentUuid = this.store.resolvePath(this.path);
    const childPath = `${this.path}/${node.name}`;
    this.store.addNode(node.id, node.node_type, node.name, parentUuid, childPath, node.data);
    for (const ts of node.timeseries)
      this.store.registerSeries("node", node.id, {
        data_type: ts.data_type,
        name: ts.name,
        canonical_unit: ts.unit,
        timeseries_type: ts.timeseries_type,
      });
    return new MockScope(this.store, childPath);
  }

  async write(points: Point[], opts: WriteOpts): Promise<void> {
    const uuid = this.store.resolvePath(this.path);
    const series = this.store.findSeries("node", uuid, opts.data_type, opts.name);
    this.store.writeSeries(series.series_id, points, opts.knowledge_time ?? nowIso());
  }

  async read(args: ReadArgs): Promise<ReadFrame> {
    const metas = this.store.seriesUnderSubtree(this.path, args.data_type, args.name, this.whereType);
    return this.store.readFrame(metas, args);
  }

  async delete(opts: { dry_run?: boolean } = {}): Promise<TreeDiff> {
    const uuid = this.store.resolvePath(this.path);
    const before = this.store.snapshot(uuid);
    if (!opts.dry_run) this.store.del(uuid);
    return new TreeDiff([{ uuid, kind: "delete", old: before, new: null }]);
  }
}

export class MockTransaction {
  private readonly changes: NodeChange[] = [];

  constructor(private readonly store: MockStore) {}

  get_node(...path: string[]): MockTxnScope {
    return new MockTxnScope(this.store, path.join("/"), this.changes);
  }

  preview(): TreeDiff {
    return new TreeDiff([...this.changes]);
  }

  async commit(): Promise<void> {
    /* mutations already applied in-memory; commit is a no-op for the mock */
  }

  async rollback(): Promise<void> {
    /* not exercised by the demo */
  }
}

class MockTxnScope {
  constructor(
    private readonly store: MockStore,
    readonly path: string,
    private readonly changes: NodeChange[],
  ) {}

  async move_to(newParentPath: string): Promise<void> {
    const uuid = this.store.resolvePath(this.path);
    const before = this.store.snapshot(uuid);
    this.store.move(uuid, newParentPath);
    this.changes.push({ uuid, kind: "update", old: before, new: this.store.snapshot(uuid) });
  }

  async update(patch: Record<string, unknown>): Promise<void> {
    const uuid = this.store.resolvePath(this.path);
    const before = this.store.snapshot(uuid);
    this.store.update(uuid, patch);
    this.changes.push({ uuid, kind: "update", old: before, new: this.store.snapshot(uuid) });
  }

  async delete(): Promise<void> {
    const uuid = this.store.resolvePath(this.path);
    const before = this.store.snapshot(uuid);
    this.store.del(uuid);
    this.changes.push({ uuid, kind: "delete", old: before, new: null });
  }
}

export class MockClient {
  constructor(private readonly store: MockStore) {}

  async create(): Promise<void> {}

  async register_tree(root: TsModel): Promise<void> {
    this.store.addNode(root.id, root.node_type, root.name, null, root.name, root.data);
    for (const ts of root.timeseries)
      this.store.registerSeries("node", root.id, {
        data_type: ts.data_type,
        name: ts.name,
        canonical_unit: ts.unit,
        timeseries_type: ts.timeseries_type,
      });
  }

  get_node(...path: string[]): MockScope {
    return new MockScope(this.store, path.join("/"));
  }

  async create_edge(edge: TsEdge): Promise<void> {
    this.store.addEdge({
      uuid: edge.id,
      edge_type: edge.edge_type,
      name: edge.name,
      from_id: edge.from_id,
      to_id: edge.to_id,
      data: edge.data,
    });
    for (const ts of edge.timeseries)
      this.store.registerSeries("edge", edge.id, {
        data_type: ts.data_type,
        name: ts.name,
        canonical_unit: ts.unit,
        timeseries_type: ts.timeseries_type,
      });
  }

  async transaction(): Promise<MockTransaction> {
    return new MockTransaction(this.store);
  }

}
