import type { Workflow } from "#jevlint/graph/schema.ts";

interface LayoutInput {
  graph: Workflow;
}

interface RankInput extends LayoutInput {
  ranks: Map<string, number>;
}

type Layout = Workflow["layout"];

function reachableRanks({ graph }: LayoutInput): Map<string, number> {
  const ranks = new Map<string, number>([[graph.entry, 0]]);
  const queue = [graph.entry];

  for (const source of queue) {
    for (const edge of graph.edges.filter(
      (candidate) => candidate.source === source,
    )) {
      if (ranks.has(edge.target)) continue;

      ranks.set(edge.target, ranks.get(source)! + 1);
      queue.push(edge.target);
    }
  }

  return ranks;
}

function forwardRanks({ graph, ranks }: RankInput) {
  const queue = [...ranks.keys()];

  const indegree = new Map(
    queue.map((id) => [
      id,
      graph.edges.filter((edge) => edge.target === id && ranks.has(edge.source))
        .length,
    ]),
  );

  const ready = queue.filter((id) => indegree.get(id) === 0);

  for (const source of ready) {
    for (const edge of graph.edges.filter(
      (candidate) => candidate.source === source,
    )) {
      ranks.set(
        edge.target,
        Math.max(ranks.get(edge.target)!, ranks.get(source)! + 1),
      );

      indegree.set(edge.target, indegree.get(edge.target)! - 1);

      if (indegree.get(edge.target) === 0) ready.push(edge.target);
    }
  }
}

export function orderedLayout({ graph }: LayoutInput): Layout {
  const ranks = reachableRanks({ graph });

  forwardRanks({ graph, ranks });

  const rows = new Map<number, number>();
  const layout: Layout = {};

  for (const node of graph.nodes) {
    const rank = ranks.get(node.id) ?? 0;
    const row = rows.get(rank) ?? 0;

    layout[node.id] = { x: 50 + rank * 330, y: 130 + row * 180 };
    rows.set(rank, row + 1);
  }

  return layout;
}
