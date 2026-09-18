import { workflowSchema } from "#jevlint/graph/schema.ts";
import {
  inspectorTabs,
  byId,
  element,
  notice,
  saveDefinition,
} from "#studio/model.ts";
import { field, selectField, submitButton } from "#studio/fields.ts";
import { judgmentCard } from "#studio/monitor.ts";
import { nodeEditor } from "#studio/node-editor.ts";
import type { StudioModel } from "#studio/model.ts";

interface InspectorInput {
  model: StudioModel;
}

function workflowFields({ model }: InspectorInput): HTMLElement[] {
  return [
    field({ name: "name", label: "Graph name", value: model.graph.name }),
    field({ name: "model", label: "Model", value: model.graph.model }),
    selectField({
      name: "entry",
      label: "Entry node",
      value: model.graph.entry,
      options: model.graph.nodes
        .filter((node) => node.type === "input")
        .map((node) => ({
          id: node.id,
          label: node.label,
        })),
    }),
    field({
      name: "maxSteps",
      label: "Maximum steps · bounds loops",
      value: String(model.graph.maxSteps),
      type: "number",
    }),
    field({
      name: "timeoutMs",
      label: "Request timeout · milliseconds",
      value: String(model.graph.timeoutMs),
      type: "number",
    }),
    submitButton({ label: "Apply workflow settings" }),
  ];
}

function stateEditor({ model }: InspectorInput): HTMLElement {
  const panel = element({ className: "editor-panel" });
  const form = document.createElement("form");
  const fieldset = document.createElement("fieldset");

  fieldset.disabled = model.running;

  panel.append(
    element({ className: "section-label", text: "WORKFLOW SETTINGS" }),
    element({ tag: "h2", text: "Workflow settings." }),
  );

  fieldset.append(...workflowFields({ model }));
  form.append(fieldset);

  form.onsubmit = (event) => {
    event.preventDefault();

    try {
      const data = new FormData(form);

      model.graph = workflowSchema.parse({
        ...model.graph,
        name: data.get("name"),
        model: data.get("model"),
        entry: data.get("entry"),
        maxSteps: Number(data.get("maxSteps")),
        timeoutMs: Number(data.get("timeoutMs")),
      });

      saveDefinition({ model });
      notice({ message: "Workflow settings saved." });
      model.redraw();
    } catch (error) {
      notice({
        message: error instanceof Error ? error.message : "Invalid state",
        error: true,
      });
    }
  };

  panel.append(
    form,
    element({
      className: "inspector-help",
      text: "Provide data in the Input / Start node. Live mode sends that context and earlier judgments to Jev. A run uses a frozen snapshot of your graph.",
    }),
  );

  return panel;
}

function formatGuide(): HTMLElement {
  const panel = element({ className: "editor-panel format-guide" });

  panel.append(
    element({ className: "section-label", text: "PORTABLE BY DESIGN" }),
    element({ tag: "h2", text: "A graph is just JSON." }),
  );

  const sections = [
    [
      "workflow.jev.json",
      "One versioned document: nodes, explicit edges, input state, and a separate layout map. Review it in Git. Run it without this editor.",
    ],
    [
      "Meaning before machinery",
      "Input nodes provide the starting context. Choice nodes describe competing options; Noul nodes ask yes/no questions. State nodes merge JSON. Finish nodes return an outcome. No embedded JavaScript or shell execution.",
    ],
    [
      "Probability ≠ confidence",
      "The selected node’s inspector shows option probabilities; confidence can pause execution. Noul shows P(yes), with your threshold choosing the route. These are judgments, not guarantees.",
    ],
    [
      "Runs are separate",
      "Each execution streams ordered events to the monitor and a .jevlint/runs/*.jsonl file. The first event contains the graph snapshot; later events preserve answers, state changes, and transitions.",
    ],
    [
      "Room to grow",
      "Version 1 rejects unknown node types and future versions instead of guessing. Add deliberate migrations for new versions. A folder can hold many graphs and fixtures without changing the file format.",
    ],
    [
      "First-version boundaries",
      "One active path, one judgment per call, bounded loops, no external action execution yet. Finish prepares a handoff; it does not call another LLM. Simulation always favors the first Choice option.",
    ],
  ];

  for (const [title, text] of sections)
    panel.append(
      element({ tag: "h3", text: title }),
      element({ tag: "p", text }),
    );

  return panel;
}

function inspectorPanels({ model }: InspectorInput): HTMLElement[] {
  if (model.tab === "format") return [formatGuide()];

  if (model.tab === "state") return [stateEditor({ model })];

  const node = model.graph.nodes.find(
    (candidate) => candidate.id === model.selected,
  );

  return node ? [judgmentCard({ model }), nodeEditor({ model, node })] : [];
}

export function drawInspector({ model }: InspectorInput) {
  for (const tab of Object.values(inspectorTabs))
    byId({ id: `tab-${tab}` }).setAttribute(
      "aria-pressed",
      String(model.tab === tab),
    );

  const container = byId({ id: "inspector-content" });
  const selection = `${model.tab}:${model.selected}`;

  const keepContextOpen =
    container.dataset.selection === selection &&
    container.querySelector("details")?.open;

  if (container.dataset.selection !== selection) container.scrollTop = 0;

  container.dataset.selection = selection;

  container.replaceChildren(...inspectorPanels({ model }));

  const contextDetails = container.querySelector("details");

  if (keepContextOpen && contextDetails) contextDetails.open = true;
}
