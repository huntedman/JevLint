import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { parseWorkflow } from "#jevlint/graph/schema.ts";
import { withInputNode } from "#jevlint/graph/input-node.ts";
import { runWorkflow } from "#jevlint/graph/runner.ts";
import { orderedLayout } from "#studio/flow-layout.ts";
import type { RunEvent } from "#jevlint/graph/trace.ts";

const fixture = JSON.parse(
  await readFile(
    new URL("../../examples/graphs/review.jev.json", import.meta.url),
    "utf8",
  ),
);

it("executes input before judgments and records the context received by each command", async () => {
  const graph = parseWorkflow({ value: fixture });
  const events: RunEvent[] = [];
  let calls = 0;

  await runWorkflow({
    graph,
    mode: "demo",
    signal: new AbortController().signal,
    evaluate: async ({ state }) => {
      calls++;
      expect(state.file).toBe("checkout.ts");

      return {
        type: "choice",
        choice: "clean",
        probabilities: { magic_strings: 0.1, unclear_names: 0.1, clean: 0.8 },
        confidence: 0.7,
      };
    },
    emit: async (event) => {
      events.push(event);
    },
  });

  expect(calls).toBe(1);

  expect(
    events
      .filter((event) => event.type === "node-started")
      .map((event) => event.nodeId),
  ).toEqual(["input", "classify", "pass"]);

  expect(
    events.find(
      (event) => event.type === "node-started" && event.nodeId === "classify",
    )?.state?.file,
  ).toBe("checkout.ts");

  expect(graph.state).toEqual({});
  expect(events.at(-1)?.type).toBe("completed");
});

it("promotes legacy state to a visible input without changing the original file", () => {
  const graph = parseWorkflow({ value: fixture });

  graph.nodes = graph.nodes.filter((node) => node.type !== "input");
  graph.edges = graph.edges.filter((edge) => edge.source !== "input");
  graph.entry = "classify";
  graph.state = { file: "legacy.ts" };

  const migrated = withInputNode({ graph });

  expect(parseWorkflow({ value: migrated }).nodes[0]).toMatchObject({
    type: "input",
    values: graph.state,
  });

  expect(migrated.edges[0]).toMatchObject({
    source: migrated.entry,
    target: "classify",
  });

  expect(graph.entry).toBe("classify");
  expect(withInputNode({ graph: migrated })).toEqual(migrated);
});

it("rejects routes back into input and entry points that skip the input", () => {
  const graph = parseWorkflow({ value: fixture });

  graph.edges[1].target = graph.entry;
  expect(() => parseWorkflow({ value: graph })).toThrow("incoming");
  graph.entry = "classify";
  expect(() => parseWorkflow({ value: graph })).toThrow("entry");
});

it("arranges branches and their shared successors in execution order without removing loops", () => {
  const graph = parseWorkflow({ value: fixture });
  const layout = orderedLayout({ graph });

  for (const edge of graph.edges)
    expect(layout[edge.target].x).toBeGreaterThan(layout[edge.source].x);

  graph.edges.find((edge) => edge.id === "magic-no")!.target = "classify";

  expect(Object.keys(orderedLayout({ graph }))).toHaveLength(
    graph.nodes.length,
  );
});
