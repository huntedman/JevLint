import { z } from "zod";
import { parseWorkflow } from "#jevlint/graph/schema.ts";
import { eventSchema } from "#jevlint/graph/trace.ts";
import { byId, notice } from "#studio/model.ts";
import type { StudioModel } from "#studio/model.ts";

interface ExecutionInput {
  model: StudioModel;
}

interface ReadStreamInput extends ExecutionInput {
  response: Response;
}

interface EventLineInput extends ExecutionInput {
  line: string;
}

interface ExecutionErrorInput extends ExecutionInput {
  error: unknown;
}

function receiveEvent({ model, line }: EventLineInput) {
  const event = eventSchema.parse(JSON.parse(line));

  if (event.sequence !== model.events.length)
    throw new Error("The run event sequence was interrupted.");

  model.events.push(event);

  if (event.message)
    notice({ message: event.message, error: event.type === "error" });

  model.redraw();
}

async function readEvents({ model, response }: ReadStreamInput) {
  if (!response.body) throw new Error("The server returned no event stream.");

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  try {
    let chunk = await reader.read();

    while (!chunk.done) {
      buffer += chunk.value;

      const lines = buffer.split("\n");

      buffer = lines.pop() ?? "";

      for (const line of lines) receiveEvent({ model, line });

      chunk = await reader.read();
    }

    if (
      !["completed", "paused", "error", "cancelled", "limit"].includes(
        model.events.at(-1)?.type ?? "",
      )
    )
      throw new Error("Connection ended before the run finished.");
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

function executionFailed({ model, error }: ExecutionErrorInput) {
  const cancelled = model.controller?.signal.aborted;
  const message = error instanceof Error ? error.message : "Run failed.";

  if (cancelled)
    model.events.push({
      version: 1,
      sequence: model.events.length,
      at: new Date().toISOString(),
      type: "cancelled",
      message: "Stopped locally. Server cancellation is recorded in its trace.",
    });

  notice({ message: cancelled ? "Run stopped." : message, error: !cancelled });
}

async function requestRun({ model }: ExecutionInput): Promise<Response> {
  const graph = parseWorkflow({ value: model.graph });
  const mode = byId({ id: "mode", type: HTMLSelectElement }).value;

  model.controller = new AbortController();
  model.running = true;
  model.events = [];
  model.inspectedEvent = null;
  model.redraw();

  notice({
    message:
      mode === "live"
        ? "Live run · sending graph context to Jev. Probabilities update after each call."
        : "Simulation · fixed sample answers, no API requests.",
  });

  const response = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph, mode }),
    signal: model.controller.signal,
  });

  if (!response.ok) {
    const body: unknown = await response.json();

    throw new Error(z.object({ error: z.string() }).parse(body).error);
  }

  return response;
}

export async function executeGraph({ model }: ExecutionInput) {
  if (model.running) return;

  try {
    await readEvents({ model, response: await requestRun({ model }) });
  } catch (error) {
    executionFailed({ model, error });
  } finally {
    model.running = false;
    model.controller = null;
    model.redraw();
  }
}
