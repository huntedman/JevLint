import { withInputNode } from "#jevlint/graph/input-node.ts";
import {
  nodeOutputs,
  parseWorkflow,
  workflowSchema,
} from "#jevlint/graph/schema.ts";
import {
  inspectorTabs,
  byId,
  download,
  notice,
  saveDefinition,
} from "#studio/model.ts";
import { fitCanvas } from "#studio/canvas.ts";
import { executeGraph } from "#studio/execution.ts";
import type { StudioModel } from "#studio/model.ts";
import type { WorkflowNode } from "#jevlint/graph/schema.ts";

interface ActionsInput {
  model: StudioModel;
}

interface NodeDefinitionInput {
  id: string;
  type: string;
}

interface AddNodeInput extends ActionsInput {
  type: string;
}

const importFileId = "import-file";

function nodeDefinition({ id, type }: NodeDefinitionInput) {
  const definitions: Partial<Record<string, WorkflowNode>> = {
    choice: {
      id,
      label: "New choice",
      type: "choice",
      instructions: "Given `context`, which next step is most appropriate?",
      criteria: {
        proceed: "Ready to continue",
        review: "Needs further review or does not fit",
      },
      minConfidence: 0,
    },
    noul: {
      id,
      label: "New condition",
      type: "noul",
      instructions:
        "Does `context` meet the condition? Describe the condition here.",
      threshold: 0.8,
    },
    "set-state": {
      id,
      label: "Update context",
      type: "set-state",
      values: { reviewed: true },
    },
    end: {
      id,
      label: "New outcome",
      type: "end",
      output: "Workflow complete.",
    },
  };

  return definitions[type];
}

function addNode({ model, type }: AddNodeInput) {
  if (model.running || model.graph.nodes.length >= 100) return;

  const id = `node_${crypto.randomUUID().slice(0, 8)}`;

  const node = nodeDefinition({ id, type });

  if (!node) return;

  const selectedPosition = model.graph.layout[model.selected] ?? {
    x: 100,
    y: 100,
  };

  model.graph.nodes.push(node);

  model.graph.layout[id] = {
    x: Math.min(9500, selectedPosition.x + 80),
    y: Math.min(9500, selectedPosition.y + 180),
  };

  const target =
    model.graph.nodes.find((candidate) => candidate.type === "end")?.id ?? id;

  for (const output of nodeOutputs({ node }))
    model.graph.edges.push({
      id: `edge_${crypto.randomUUID()}`,
      source: id,
      output,
      target,
    });

  model.selected = id;
  model.tab = "node";
  saveDefinition({ model });
  model.redraw();

  notice({
    message:
      "Node added. Connect the input or another node’s output to it in the right panel.",
  });
}

async function importGraph({ model }: ActionsInput) {
  const input = byId({ id: importFileId, type: HTMLInputElement });
  const file = input.files?.[0];

  if (!file || model.running) return;

  try {
    if (file.size > 1_000_000) throw new Error("Graph exceeds the 1 MB limit.");

    const graph = parseWorkflow({ value: JSON.parse(await file.text()) });

    model.graph = withInputNode({ graph });
    model.selected = model.graph.entry;
    model.tab = "node";
    model.events = [];
    model.inspectedEvent = null;
    saveDefinition({ model });
    model.redraw();
    fitCanvas({ model });

    notice({
      message:
        "Graph imported. Saved in this browser; export to keep a portable copy.",
    });
  } catch (error) {
    notice({
      message: error instanceof Error ? error.message : "Invalid graph",
      error: true,
    });
  }

  input.value = "";
}

function bindNodeLibrary({ model }: ActionsInput) {
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-add]",
  ))
    button.onclick = () => {
      if (button.dataset.add === "input") {
        model.selected = model.graph.entry;
        model.tab = "node";
        model.redraw();

        return;
      }

      addNode({ model, type: button.dataset.add ?? "" });
    };
}

export function bindActions({ model }: ActionsInput) {
  bindNodeLibrary({ model });

  for (const tab of Object.values(inspectorTabs))
    byId({ id: `tab-${tab}` }).onclick = () => {
      model.tab = tab;
      model.redraw();
    };

  byId({ id: "settings" }).onclick = () => {
    model.tab = "state";
    model.redraw();
  };

  byId({ id: "run" }).onclick = () => {
    void executeGraph({ model });
  };

  byId({ id: "stop" }).onclick = () => model.controller?.abort();

  byId({ id: "import" }).onclick = () =>
    byId({ id: importFileId, type: HTMLInputElement }).click();

  byId({ id: importFileId }).onchange = () => {
    void importGraph({ model });
  };

  byId({ id: "export" }).onclick = () => {
    try {
      download({
        name: `${model.graph.id}.jev.json`,
        text: `${JSON.stringify(parseWorkflow({ value: model.graph }), null, 2)}\n`,
      });
    } catch (error) {
      notice({
        message: error instanceof Error ? error.message : "Invalid graph",
        error: true,
      });
    }
  };

  byId({ id: "export-run" }).onclick = () =>
    download({
      name: `${model.graph.id}-${Date.now()}.jsonl`,
      text:
        model.events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    });

  bindExample({ model });
  byId({ id: "new-graph" }).onclick = () => createGraph({ model });
}

function bindExample({ model }: ActionsInput) {
  byId({ id: "example" }).onclick = () => {
    void fetch("/api/example")
      .then((response) => response.json())
      .then((value: unknown) => {
        model.graph = withInputNode({ graph: workflowSchema.parse(value) });
        model.selected = model.graph.entry;
        model.tab = "node";
        model.events = [];
        model.inspectedEvent = null;
        saveDefinition({ model });
        model.redraw();
        fitCanvas({ model });
      })
      .catch(() =>
        notice({ message: "Could not load the example.", error: true }),
      );
  };
}

function createGraph({ model }: ActionsInput) {
  if (model.running) return;

  model.graph = workflowSchema.parse({
    format: "jev-workflow",
    version: 1,
    id: `graph_${crypto.randomUUID().slice(0, 8)}`,
    name: "Untitled graph",
    model: "jev-latest",
    entry: "input",
    maxSteps: 20,
    timeoutMs: 30000,
    state: {},
    nodes: [
      { id: "input", label: "Workflow input", type: "input", values: {} },
      {
        id: "finish",
        label: "Finish",
        type: "end",
        output: "Workflow complete.",
      },
    ],
    edges: [
      { id: "input-next", source: "input", output: "next", target: "finish" },
    ],
    layout: { input: { x: 60, y: 140 }, finish: { x: 430, y: 140 } },
  });

  model.selected = "input";
  model.tab = "node";
  saveDefinition({ model });
  model.redraw();
  fitCanvas({ model });

  notice({
    message:
      "New graph. Set the input data, add a judgment, and connect the input’s next route to it.",
  });
}
