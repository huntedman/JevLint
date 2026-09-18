import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { parseWorkflow } from "#jevlint/graph/schema.ts";
import { runWorkflow } from "#jevlint/graph/runner.ts";
import { liveEvaluator } from "#jevlint/graph/judgment.ts";
import type { RunEvent } from "#jevlint/graph/trace.ts";

const fixture = JSON.parse(
  await readFile(
    new URL("../../examples/graphs/review.jev.json", import.meta.url),
    "utf8",
  ),
);

const choiceAnswer = {
  type: "choice",
  choice: "magic_strings",
  probabilities: { magic_strings: 0.85, unclear_names: 0.1, clean: 0.05 },
  confidence: 0.7,
} as const;

function graph() {
  const value = parseWorkflow({ value: structuredClone(fixture) });
  const input = value.nodes.find((node) => node.type === "input")!;

  value.state = input.values;
  value.entry = "classify";
  value.nodes = value.nodes.filter((node) => node.id !== input.id);
  value.edges = value.edges.filter((edge) => edge.source !== input.id);
  delete value.layout[input.id];

  return value;
}

it("routes validated judgments, propagates state, and emits ordered trace events", async () => {
  const events: RunEvent[] = [];
  const workflow = graph();

  await runWorkflow({
    graph: workflow,
    mode: "demo",
    signal: new AbortController().signal,
    evaluate: async ({ node, results }) => {
      if (node.type === "choice") return choiceAnswer;

      expect(results.classify).toEqual(choiceAnswer);

      return { type: "noul", noul: 0.9 };
    },
    emit: async (event) => {
      events.push(event);
    },
  });

  expect(
    events
      .filter((event) => event.type === "transition")
      .map((event) => event.edgeId),
  ).toEqual(["classify-magic", "magic-yes", "flag-next"]);

  expect(events.at(-1)).toMatchObject({
    type: "completed",
    nodeId: "review",
    state: { needsReview: true },
  });

  expect(events.map((event) => event.sequence)).toEqual(
    events.map((_, index) => index),
  );

  expect(workflow.state).not.toHaveProperty("needsReview");
});

it("pauses below confidence threshold without executing the next node", async () => {
  const workflow = graph();
  const node = workflow.nodes[0];
  const events: RunEvent[] = [];

  if (node.type !== "choice") throw new Error("Invalid fixture");

  node.minConfidence = 0.9;

  await runWorkflow({
    graph: workflow,
    mode: "demo",
    signal: new AbortController().signal,
    evaluate: async () => choiceAnswer,
    emit: async (event) => {
      events.push(event);
    },
  });

  expect(events.at(-1)?.type).toBe("paused");
  expect(events.some((event) => event.type === "transition")).toBe(false);
});

it("bounds cycles and uses Noul threshold instead of inventing confidence", async () => {
  const workflow = graph();
  const events: RunEvent[] = [];

  workflow.entry = "magic";
  workflow.maxSteps = 2;
  workflow.edges.find((edge) => edge.id === "magic-no")!.target = "magic";

  await runWorkflow({
    graph: workflow,
    mode: "demo",
    signal: new AbortController().signal,
    evaluate: async () => ({ type: "noul", noul: 0.6 }),
    emit: async (event) => {
      events.push(event);
    },
  });

  expect(
    events
      .filter((event) => event.type === "transition")
      .map((event) => event.edgeId),
  ).toEqual(["magic-no", "magic-no"]);

  expect(events.at(-1)?.type).toBe("limit");
});

it("does not apply a response that arrives after cancellation", async () => {
  const controller = new AbortController();
  const events: RunEvent[] = [];

  await runWorkflow({
    graph: graph(),
    mode: "demo",
    signal: controller.signal,
    evaluate: async () => {
      controller.abort();

      return choiceAnswer;
    },
    emit: async (event) => {
      events.push(event);
    },
  });

  expect(events.at(-1)?.type).toBe("cancelled");
  expect(events.some((event) => event.type === "judgment")).toBe(false);
});

it("fails safely on malformed model output", async () => {
  const events: RunEvent[] = [];

  await runWorkflow({
    graph: graph(),
    mode: "demo",
    signal: new AbortController().signal,
    evaluate: async () => ({ ...choiceAnswer, probabilities: { other: 1 } }),
    emit: async (event) => {
      events.push(event);
    },
  });

  expect(events.at(-1)?.type).toBe("error");
  expect(events.some((event) => event.type === "transition")).toBe(false);
});

it.each(["version", "target", "duplicate", "missing-route"])(
  "rejects invalid %s before execution",
  (kind) => {
    const value = structuredClone(fixture);

    if (kind === "version") value.version = 2;

    if (kind === "target") value.edges[0].target = "missing";

    if (kind === "duplicate") value.nodes.push(value.nodes[0]);

    if (kind === "missing-route") value.edges.pop();

    expect(() => parseWorkflow({ value })).toThrow();
  },
);

it("uses the documented Choice request and keeps credentials in HTTP headers", async () => {
  const node = graph().nodes[0];

  if (node.type !== "choice") throw new Error("Invalid fixture");

  const evaluate = liveEvaluator({
    apiKey: "test-secret",
    request: async (url, init) => {
      expect(url).toBe("https://api.typesafe.ai/v1/systemone");

      const body = JSON.parse(String(init?.body));

      expect(body.questions.classify).toEqual({
        type: "choice",
        instructions: node.instructions,
        criteria: node.criteria,
      });

      expect(body.state).toEqual({ context: { file: "sample" }, results: {} });
      expect(String(init?.body)).not.toContain("test-secret");

      return Response.json({ answers: { classify: choiceAnswer } });
    },
  });

  expect(
    await evaluate({
      node,
      state: { file: "sample" },
      results: {},
      model: "jev-latest",
      timeoutMs: 500,
      signal: new AbortController().signal,
    }),
  ).toEqual(choiceAnswer);
});
