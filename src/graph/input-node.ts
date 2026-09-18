import type { Workflow } from "#jevlint/graph/schema.ts";

interface InputNodeInput {
  graph: Workflow;
}

export function withInputNode({ graph }: InputNodeInput): Workflow {
  if (graph.nodes.some((node) => node.type === "input")) return graph;

  if (graph.nodes.length >= 100)
    throw new Error(
      "Remove a node before adding the input/start node (100-node limit).",
    );

  const migrated = structuredClone(graph);
  let suffix = 0;
  let id = "input";

  while (graph.nodes.some((node) => node.id === id)) id = `input_${++suffix}`;

  let edgeId = "input-next";

  while (graph.edges.some((edge) => edge.id === edgeId))
    edgeId = `input-next-${++suffix}`;

  migrated.nodes.unshift({
    id,
    label: "Workflow input",
    type: "input",
    values: migrated.state,
  });

  migrated.edges.unshift({
    id: edgeId,
    source: id,
    output: "next",
    target: graph.entry,
  });

  migrated.layout[id] = { x: 40, y: 160 };
  migrated.entry = id;
  migrated.state = {};
  migrated.maxSteps = Math.min(500, migrated.maxSteps + 1);

  for (const node of graph.nodes) {
    const position = graph.layout[node.id] ?? { x: 100, y: 100 };

    migrated.layout[node.id] = {
      x: Math.min(10000, position.x + 300),
      y: position.y,
    };
  }

  return migrated;
}
