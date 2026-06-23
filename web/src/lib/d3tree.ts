import { hierarchy, tree as d3tree, type HierarchyNode } from "d3";
import type { TreeNode } from "../api/client";

export const BOX_W = 226;

export interface LaidNode {
  node: TreeNode;
  x: number; // horizontal (from depth)
  y: number; // vertical center (from breadth)
}
export interface LaidLink {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}
export interface Layout {
  nodes: LaidNode[];
  links: LaidLink[];
  pos: Map<string, { x: number; y: number }>;
}

const PAD = 44;

/** Height of a node card given how many series it carries (must stay in sync with CSS). */
export function nodeHeight(n: TreeNode): number {
  return 48 + (n.series.length > 0 ? n.series.length * 24 + 6 : 0);
}

/** Left-to-right tree layout for a forest of portfolio roots. */
export function layoutTree(roots: TreeNode[]): Layout {
  const empty: Layout = { nodes: [], links: [], pos: new Map() };
  if (roots.length === 0) return empty;

  const virtual = { name: "__root__", children: roots } as unknown as TreeNode;
  const root = hierarchy<TreeNode>(virtual, (d) => d.children);
  d3tree<TreeNode>().nodeSize([128, 246])(root);

  const all = root.descendants().filter((d) => d.depth > 0);
  const minB = Math.min(...all.map((d) => d.x ?? 0));
  const minD = Math.min(...all.map((d) => d.y ?? 0));

  const hx = (d: HierarchyNode<TreeNode>) => (d.y ?? 0) - minD + PAD; // horizontal
  const vy = (d: HierarchyNode<TreeNode>) => (d.x ?? 0) - minB + PAD; // vertical

  const pos = new Map<string, { x: number; y: number }>();
  const nodes: LaidNode[] = all.map((d) => {
    const x = hx(d);
    const y = vy(d);
    pos.set(d.data.uuid, { x, y });
    return { node: d.data, x, y };
  });

  const links: LaidLink[] = root
    .links()
    .filter((l) => l.source.depth > 0)
    .map((l) => ({
      sx: hx(l.source) + BOX_W,
      sy: vy(l.source),
      tx: hx(l.target),
      ty: vy(l.target),
    }));

  return { nodes, links, pos };
}

/** Cubic bezier between two points (horizontal flow). */
export function linkPath(sx: number, sy: number, tx: number, ty: number): string {
  const mx = (sx + tx) / 2;
  return `M${sx},${sy}C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
}

/** Grid edge: bows out to the right of both endpoints' right edges. */
export function edgePath(sx: number, sy: number, tx: number, ty: number): string {
  const bow = 56;
  return `M${sx},${sy}C${sx + bow},${sy} ${tx + bow},${ty} ${tx},${ty}`;
}
