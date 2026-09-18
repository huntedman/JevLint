import { nodeContext } from "#studio/node-context.ts";
import { nodeOutputs, workflowSchema } from "#jevlint/graph/schema.ts";
import { field, selectField, submitButton } from "#studio/fields.ts";
import { element, notice, saveDefinition } from "#studio/model.ts";
import type { StudioModel } from "#studio/model.ts";
import type { WorkflowNode } from "#jevlint/graph/schema.ts";

interface QuestionFieldsInput {
  node: WorkflowNode;
}

interface NodeEditorInput {
  model: StudioModel;
  node: WorkflowNode;
}

interface ApplyNodeInput extends NodeEditorInput {
  form: HTMLFormElement;
}

function applyNode({ model, node, form }: ApplyNodeInput) {
  const data = new FormData(form);
  const updated = structuredClone(node);

  updated.label = String(data.get("label"));

  if (updated.type === "choice" || updated.type === "noul")
    updated.instructions = String(data.get("instructions"));

  if (updated.type === "choice") {
    updated.minConfidence = Number(data.get("policy"));

    const keys = Object.keys(updated.criteria);
    const renamed = keys.map((key) => String(data.get(`key:${key}`)));

    if (new Set(renamed).size !== renamed.length)
      throw new Error("Option IDs must be unique.");

    updated.criteria = Object.fromEntries(
      keys.map((key, index) => [
        renamed[index],
        String(data.get(`criterion:${key}`)),
      ]),
    );
  }

  if (updated.type === "noul") updated.threshold = Number(data.get("policy"));

  if ("values" in updated)
    updated.values = JSON.parse(String(data.get("values")));

  if (updated.type === "end") updated.output = String(data.get("output"));

  const graph = structuredClone(model.graph);

  graph.nodes = graph.nodes.map((candidate) =>
    candidate.id === node.id ? updated : candidate,
  );

  graph.edges = graph.edges.map((edge) =>
    edge.source === node.id
      ? {
          ...edge,
          output:
            node.type === "choice"
              ? String(data.get(`key:${edge.output}`))
              : edge.output,
          target: String(data.get(`target:${edge.output}`)),
        }
      : edge,
  );

  model.graph = workflowSchema.parse(graph);
  saveDefinition({ model });
  notice({ message: "Node updated. The next run will use this definition." });
  model.redraw();
}

function questionFields({ node }: QuestionFieldsInput): HTMLElement[] {
  if (node.type === "end")
    return [
      field({
        name: "output",
        label: "Outcome message",
        value: node.output,
        multiline: true,
      }),
    ];

  if (node.type === "input" || node.type === "set-state")
    return [
      field({
        name: "values",
        label:
          node.type === "input"
            ? "Input data · JSON"
            : "Merge into context · JSON",
        value: JSON.stringify(node.values, null, 2),
        multiline: true,
      }),
    ];

  return [
    field({
      name: "instructions",
      label: "Jev instructions",
      value: node.instructions,
      multiline: true,
    }),
    field({
      name: "policy",
      label:
        node.type === "choice"
          ? "Minimum confidence · 0–1"
          : "Yes threshold · 0–1",
      value: String(
        node.type === "choice" ? node.minConfidence : node.threshold,
      ),
      type: "number",
    }),
  ];
}

function routeFields({ model, node }: NodeEditorInput): HTMLElement {
  const routes = element({ className: "route-fields" });

  for (const output of nodeOutputs({ node })) {
    const route = element({ className: "route-field" });

    const target =
      model.graph.edges.find(
        (edge) => edge.source === node.id && edge.output === output,
      )?.target ?? "";

    route.append(element({ className: "route-label", text: `↳ ${output}` }));

    if (node.type === "choice")
      route.append(
        field({ name: `key:${output}`, label: "Option ID", value: output }),
      );

    if (node.type === "choice")
      route.append(
        field({
          name: `criterion:${output}`,
          label: "When this means…",
          value: node.criteria[output],
          multiline: true,
        }),
      );

    route.append(
      selectField({
        name: `target:${output}`,
        label: "Continue to",
        value: target,
        options: [
          { id: "", label: "Choose a target…" },
          ...model.graph.nodes
            .filter((candidate) => candidate.type !== "input")
            .map((candidate) => ({
              id: candidate.id,
              label: candidate.label,
            })),
        ],
      }),
    );

    routes.append(route);
  }

  return routes;
}

function nodeActions({ model, node }: NodeEditorInput): HTMLElement {
  const actions = element({ className: "node-actions" });

  const remove = element({
    tag: "button",
    className: "danger-button",
    text: "Delete node",
  });

  remove.onclick = () => {
    if (
      model.graph.entry === node.id ||
      model.graph.edges.some(
        (edge) => edge.target === node.id && edge.source !== node.id,
      )
    ) {
      notice({
        message:
          "Change the entry point and reconnect incoming routes before deleting this node.",
        error: true,
      });

      return;
    }

    model.graph.nodes = model.graph.nodes.filter(
      (candidate) => candidate.id !== node.id,
    );

    model.graph.edges = model.graph.edges.filter(
      (edge) => edge.source !== node.id,
    );

    delete model.graph.layout[node.id];
    model.selected = model.graph.entry;
    saveDefinition({ model });
    model.redraw();
  };

  actions.append(remove);

  return actions;
}

function optionControls({ model, node }: NodeEditorInput): HTMLElement {
  const row = element({ className: "option-controls" });

  if (node.type !== "choice") return row;

  for (const action of ["Add option", "Remove last option"]) {
    const button = element({ tag: "button", text: action });

    button.onclick = () => {
      const keys = Object.keys(node.criteria);

      if (action === "Add option" && keys.length < 20) {
        const id = `option_${crypto.randomUUID().slice(0, 8)}`;

        node.criteria[id] = "Describe when to choose this option.";

        model.graph.edges.push({
          id: `edge_${crypto.randomUUID()}`,
          source: node.id,
          output: id,
          target:
            model.graph.nodes.find((candidate) => candidate.type === "end")
              ?.id ?? node.id,
        });
      } else if (action === "Remove last option" && keys.length > 2) {
        delete node.criteria[keys.at(-1)!];

        model.graph.edges = model.graph.edges.filter(
          (edge) => edge.source !== node.id || edge.output !== keys.at(-1),
        );
      }

      saveDefinition({ model });
      model.redraw();
    };

    row.append(button);
  }

  return row;
}

export function nodeEditor({ model, node }: NodeEditorInput): HTMLElement {
  const panel = element({ className: "editor-panel" });
  const form = document.createElement("form");
  const fieldset = document.createElement("fieldset");

  fieldset.disabled = model.running;

  panel.append(
    element({
      className: "section-label",
      text: `${node.type.toUpperCase()} / ${node.id}`,
    }),
    element({ tag: "h2", text: node.label }),
    nodeContext({ model, node }),
  );

  fieldset.append(
    field({ name: "label", label: "Node name", value: node.label }),
    ...questionFields({ node }),
    routeFields({ model, node }),
    submitButton({ label: "Apply changes" }),
  );

  for (const input of fieldset.querySelectorAll<HTMLInputElement>(
    'input[type="number"]',
  )) {
    input.min = "0";
    input.max = "1";
    input.step = "0.01";
  }

  form.append(fieldset);

  form.onsubmit = (event) => {
    event.preventDefault();

    try {
      applyNode({ model, node, form });
    } catch (error) {
      notice({
        message: error instanceof Error ? error.message : "Invalid node",
        error: true,
      });
    }
  };

  panel.append(form);

  if (!model.running)
    panel.append(optionControls({ model, node }), nodeActions({ model, node }));

  panel.append(
    element({
      className: "inspector-help",
      text: "Questions see context (your state) and results (earlier judgments). Apply changes before adding options. Connect outputs using Continue to.",
    }),
  );

  return panel;
}
