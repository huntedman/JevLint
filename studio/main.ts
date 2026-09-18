import { withInputNode } from "#jevlint/graph/input-node.ts";
import { z } from "zod";
import { workflowSchema } from "#jevlint/graph/schema.ts";
import { byId, storageKey, notice } from "#studio/model.ts";
import { drawCanvas, fitCanvas } from "#studio/canvas.ts";
import { drawInspector } from "#studio/inspector.ts";
import { drawMonitor } from "#studio/monitor.ts";
import { bindActions } from "#studio/actions.ts";
import { bindGestures } from "#studio/gestures.ts";
import type { StudioModel } from "#studio/model.ts";

async function start() {
  const example: unknown = await fetch("/api/example").then((response) =>
    response.json(),
  );

  let graph = workflowSchema.parse(example);

  try {
    const stored = localStorage.getItem(storageKey);

    if (stored) graph = workflowSchema.parse(JSON.parse(stored));
  } catch {
    notice({
      message:
        "Saved graph could not be read. The example is loaded; your saved data has not been overwritten.",
      error: true,
    });
  }

  graph = withInputNode({ graph });

  const model: StudioModel = {
    graph,
    selected: graph.entry,
    tab: "node",
    events: [],
    inspectedEvent: null,
    running: false,
    controller: null,
    viewport: { x: 20, y: 50, zoom: 0.7 },
    redraw: () => {
      byId({ id: "graph-name" }).textContent = model.graph.name;
      drawCanvas({ model });
      drawInspector({ model });
      drawMonitor({ model });
    },
  };

  bindActions({ model });
  bindGestures({ model });
  model.redraw();
  fitCanvas({ model });

  const status = z
    .object({ liveReady: z.boolean() })
    .parse(await fetch("/api/status").then((response) => response.json()));

  byId({ id: "connection" }).textContent = status.liveReady
    ? "JEV API READY"
    : "LOCAL / DEMO READY";

  window.addEventListener("beforeunload", (event) => {
    if (model.running) event.preventDefault();
  });
}

void start().catch((error: unknown) =>
  notice({
    message: error instanceof Error ? error.message : "Studio could not start.",
    error: true,
  }),
);
