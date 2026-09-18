import { element } from "#studio/model.ts";
import type { StudioModel } from "#studio/model.ts";
import type { WorkflowNode } from "#jevlint/graph/schema.ts";

interface ContextInput {
  model: StudioModel;
  node: WorkflowNode;
}

const explanations = {
  input:
    "The start of this workflow. Provide the input data here; it becomes context for the commands that follow. The next arrow runs first.",
  choice:
    "Jev reads the incoming context and earlier results, judges the options below, then follows one selected route. Low confidence pauses the run.",
  noul: "Jev judges the condition against the incoming context. Your threshold selects the yes or no arrow.",
  "set-state":
    "This command merges the configured fields into context, then follows the next arrow. It does not call Jev.",
  end: "This is an end point. Execution stops here and returns the outcome with the accumulated context.",
};

function startingContext({ model }: ContextInput) {
  const input = model.graph.nodes.find(
    (candidate) => candidate.type === "input",
  );

  return { ...model.graph.state, ...input?.values };
}

function contextSnapshot({ model, node }: ContextInput): HTMLElement {
  const details = document.createElement("details");
  const inspection = model.inspectedEvent;

  const cutoff =
    inspection?.nodeId === node.id ? inspection.sequence : Infinity;

  const events = model.events.filter((event) => event.sequence <= cutoff);
  const eventType = node.type === "input" ? "state-updated" : "node-started";

  const snapshot = events.findLast(
    (event) => event.nodeId === node.id && event.type === eventType,
  );

  const context = snapshot?.state ?? startingContext({ model, node });

  const results = Object.fromEntries(
    events
      .filter(
        (event) =>
          event.type === "judgment" &&
          event.sequence < (snapshot?.sequence ?? -1),
      )
      .map((event) => [event.nodeId, event.answer]),
  );

  details.className = "context-snapshot";

  details.append(
    element({
      tag: "summary",
      text: snapshot
        ? "Context received in this run"
        : "Starting context preview",
    }),
  );

  if (!snapshot)
    details.append(
      element({
        tag: "p",
        text: "Earlier commands may change this context. Run the graph to see exactly what this node received.",
      }),
    );

  details.append(
    element({
      tag: "pre",
      text: JSON.stringify({ context, results }, null, 2),
    }),
  );

  return details;
}

export function nodeContext({ model, node }: ContextInput): HTMLElement {
  const panel = element({ className: "node-context" });
  const incoming = model.graph.edges.filter((edge) => edge.target === node.id);

  panel.append(
    element({ className: "section-label", text: "WHAT HAPPENS HERE" }),
    element({ tag: "p", text: explanations[node.type] }),
  );

  if (incoming.length) {
    panel.append(
      element({ className: "context-label", text: "RECEIVES FROM" }),
    );

    for (const edge of incoming) {
      const previous = model.graph.nodes.find(
        (candidate) => candidate.id === edge.source,
      );

      const button = element({
        tag: "button",
        text: `${previous?.label ?? edge.source} → ${edge.output}`,
      });

      button.onclick = () => {
        model.selected = edge.source;
        model.inspectedEvent = null;
        model.redraw();
      };

      panel.append(button);
    }
  }

  if (node.type !== "input") panel.append(contextSnapshot({ model, node }));

  return panel;
}
