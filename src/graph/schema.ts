import { z } from "zod";

export type Workflow = z.infer<typeof workflowSchema>;
export type WorkflowNode = Workflow["nodes"][number];
export type JudgmentNode = Extract<WorkflowNode, { instructions: string }>;
export type WorkflowEdge = Workflow["edges"][number];
export type State = z.infer<typeof stateSchema>;

interface GraphInput {
  graph: Workflow;
}

interface ParseInput {
  value: unknown;
}

interface GraphNodeInput extends GraphInput {
  node: WorkflowNode;
}

interface GraphEdgeInput extends GraphInput {
  edge: WorkflowEdge;
}

interface NodeInput {
  node: WorkflowNode;
}

const identifier = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
const stateSchema = z.record(z.string(), z.json());
const baseNode = { id: identifier, label: z.string().trim().min(1).max(100) };
const question = { instructions: z.string().trim().min(1).max(20000) };
const probability = z.number().min(0).max(1);

const nodeSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...baseNode,
    type: z.literal("input"),
    values: stateSchema,
  }),
  z.strictObject({
    ...baseNode,
    ...question,
    type: z.literal("choice"),
    criteria: z.record(identifier, z.string().max(4000)),
    minConfidence: probability.default(0),
  }),
  z.strictObject({
    ...baseNode,
    ...question,
    type: z.literal("noul"),
    threshold: probability.default(0.5),
  }),
  z.strictObject({
    ...baseNode,
    type: z.literal("set-state"),
    values: stateSchema,
  }),
  z.strictObject({
    ...baseNode,
    type: z.literal("end"),
    output: z.string().max(10000),
  }),
]);

export const workflowSchema = z.strictObject({
  $schema: z.string().optional(),
  format: z.literal("jev-workflow"),
  version: z.literal(1),
  id: identifier,
  name: z.string().trim().min(1).max(150),
  model: z.string().trim().min(1).max(100),
  entry: identifier,
  maxSteps: z.number().int().min(1).max(500),
  timeoutMs: z.number().int().min(100).max(120000),
  state: stateSchema,
  nodes: z.array(nodeSchema).min(1).max(100),
  edges: z
    .array(
      z.strictObject({
        id: identifier,
        source: identifier,
        output: identifier,
        target: identifier,
      }),
    )
    .max(1000),
  layout: z.record(
    identifier,
    z.strictObject({
      x: z.number().min(-10000).max(10000),
      y: z.number().min(-10000).max(10000),
    }),
  ),
  metadata: stateSchema.optional(),
});

export function nodeOutputs({ node }: NodeInput): string[] {
  switch (node.type) {
    case "choice":
      return Object.keys(node.criteria);

    case "noul":
      return ["yes", "no"];

    case "input":
      return ["next"];

    case "set-state":
      return ["next"];

    case "end":
      return [];
  }
}

function nodeIssues({ graph, node }: GraphNodeInput): string[] {
  const outputs = nodeOutputs({ node });
  const issues: string[] = [];

  if (node.type === "choice" && (outputs.length < 2 || outputs.length > 20))
    issues.push(`${node.id}: Choice needs 2–20 options.`);

  for (const output of outputs) {
    if (
      graph.edges.filter(
        (edge) => edge.source === node.id && edge.output === output,
      ).length !== 1
    )
      issues.push(`${node.id}/${output}: connect exactly one target.`);
  }

  return issues;
}

function edgeIssues({ graph, edge }: GraphEdgeInput): string[] {
  const source = graph.nodes.find((node) => node.id === edge.source);

  if (!source || !graph.nodes.some((node) => node.id === edge.target))
    return [`${edge.id}: node does not exist.`];

  if (!nodeOutputs({ node: source }).includes(edge.output))
    return [`${edge.id}: output does not exist.`];

  return [];
}

function inputIssues({ graph }: GraphInput): string[] {
  const inputs = graph.nodes.filter((node) => node.type === "input");

  if (inputs.length > 1) return ["A workflow has one input/start node."];

  if (!inputs.length) return [];

  if (inputs[0].id !== graph.entry)
    return ["The input node must be the entry point."];

  if (graph.edges.some((edge) => edge.target === graph.entry))
    return ["The input/start node cannot have incoming routes."];

  return [];
}

function workflowIssues({ graph }: GraphInput): string[] {
  const issues = inputIssues({ graph });
  const ids = new Set(graph.nodes.map((node) => node.id));

  if (ids.size !== graph.nodes.length) issues.push("Node IDs must be unique.");

  if (!ids.has(graph.entry)) issues.push("Entry node is missing.");

  if (new Set(graph.edges.map((edge) => edge.id)).size !== graph.edges.length)
    issues.push("Edge IDs must be unique.");

  for (const node of graph.nodes) issues.push(...nodeIssues({ graph, node }));

  for (const edge of graph.edges) issues.push(...edgeIssues({ graph, edge }));

  return issues;
}

export function parseWorkflow({ value }: ParseInput): Workflow {
  const graph = workflowSchema.parse(value);
  const issues = workflowIssues({ graph });

  if (issues.length) throw new Error(issues.join("\n"));

  return graph;
}
