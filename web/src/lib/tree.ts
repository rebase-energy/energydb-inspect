import type { TreeNode } from "../api/client";

/** Breadth-first walk over a forest of portfolio roots (parents before children). */
export function* walkNodes(roots: TreeNode[]): Generator<TreeNode> {
  const queue = [...roots];
  while (queue.length) {
    const n = queue.shift()!;
    yield n;
    queue.push(...n.children);
  }
}
