import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { workflowSchema, parseWorkflow } from "#jevlint/graph/schema.ts";
import { runModeSchema } from "#jevlint/graph/trace.ts";
import { runWorkflow } from "#jevlint/graph/runner.ts";
import { liveEvaluator } from "#jevlint/graph/judgment.ts";
import { demoEvaluator } from "#jevlint/studio/demo-evaluator.ts";
import { readJson } from "#jevlint/studio/http.ts";
import type { IncomingMessage, ServerResponse } from "node:http";

interface SessionInput {
  request: IncomingMessage;
  response: ServerResponse;
  apiKey: string;
  runDirectory: string;
}

const runRequestSchema = z.strictObject({
  graph: workflowSchema,
  mode: runModeSchema,
});

export async function streamRun({
  request,
  response,
  apiKey,
  runDirectory,
}: SessionInput) {
  const input = runRequestSchema.parse(await readJson({ request }));
  const graph = parseWorkflow({ value: input.graph });

  if (input.mode === "live" && !apiKey)
    throw new Error("Set JEV_API_KEY on the server, then restart Studio.");

  const controller = new AbortController();
  const runId = randomUUID();
  const path = join(runDirectory, `${runId}.jsonl`);

  await mkdir(runDirectory, { recursive: true });

  response.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-store",
    "X-Run-Id": runId,
    "X-Content-Type-Options": "nosniff",
  });

  response.on("close", () => controller.abort());

  await runWorkflow({
    graph,
    mode: input.mode,
    evaluate: input.mode === "demo" ? demoEvaluator : liveEvaluator({ apiKey }),
    signal: controller.signal,
    emit: async (event) => {
      const line = `${JSON.stringify(event)}\n`;

      await appendFile(path, line, { mode: 0o600 });

      if (!response.destroyed) response.write(line);
    },
  });

  response.end();
}
