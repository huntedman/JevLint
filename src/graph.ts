import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import process from "node:process";
import { z } from "zod";
import { parseWorkflow, workflowSchema } from "#jevlint/graph/schema.ts";
import { runWorkflow } from "#jevlint/graph/runner.ts";
import { liveEvaluator } from "#jevlint/graph/judgment.ts";
import { demoEvaluator } from "#jevlint/studio/demo-evaluator.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    demo: { type: "boolean" },
    validate: { type: "boolean" },
    schema: { type: "boolean" },
  },
});

async function main() {
  if (values.schema) {
    process.stdout.write(
      `${JSON.stringify(z.toJSONSchema(workflowSchema), null, 2)}\n`,
    );

    return;
  }

  if (positionals.length !== 1)
    throw new Error(
      "Usage: pnpm graph <workflow.jev.json> [--demo | --validate] or pnpm graph --schema",
    );

  const graph = parseWorkflow({
    value: JSON.parse(await readFile(positionals[0], "utf8")),
  });

  if (values.validate) {
    process.stdout.write(`Valid graph: ${graph.name}\n`);

    return;
  }

  const controller = new AbortController();
  const stop = () => controller.abort();

  process.once("SIGINT", stop);

  try {
    await runWorkflow({
      graph,
      mode: values.demo ? "demo" : "live",
      signal: controller.signal,
      evaluate: values.demo
        ? demoEvaluator
        : liveEvaluator({ apiKey: process.env.JEV_API_KEY ?? "" }),
      emit: async (event) => {
        process.stdout.write(`${JSON.stringify(event)}\n`);

        if (["error", "cancelled", "limit", "paused"].includes(event.type))
          process.exitCode = 1;
      },
    });
  } finally {
    process.removeListener("SIGINT", stop);
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Graph failed."}\n`,
  );

  process.exitCode = 2;
});
