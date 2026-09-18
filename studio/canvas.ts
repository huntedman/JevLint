import { edgeMarkers, edgeView } from "#studio/canvas-edges.ts";
import { byId, element, nodePosition } from "#studio/model.ts";
import type { StudioModel } from "#studio/model.ts";
import type { WorkflowNode } from "#jevlint/graph/schema.ts";

interface CanvasInput {
  model: StudioModel;
}

interface NodeViewInput extends CanvasInput {
  node: WorkflowNode;
}

const symbols = {
  input: "▷",
  choice: "◇",
  noul: "◈",
  "set-state": "≔",
  end: "□",
};

function executionLabel({ model, node }: NodeViewInput): string {
  const visits = model.events.filter((event) => event.type === "node-started");
  const index = visits.findLastIndex((event) => event.nodeId === node.id);

  if (index !== -1) return `STEP ${String(index + 1).padStart(2, "0")}`;

  if (node.type === "input" || node.id === model.graph.entry) return "START";

  return node.type === "end" ? "END" : "COMMAND";
}

function nodeView({ model, node }: NodeViewInput): HTMLElement {
  const position = nodePosition({ model, nodeId: node.id });
  const view = element({ tag: "button", className: "graph-node" });

  const latest = model.events.findLast(
    (event) => event.type === "node-started",
  );

  const header = element({
    className: "node-heading",
    text: `${symbols[node.type]}  ${node.label}`,
  });

  view.dataset.nodeId = node.id;
  view.dataset.type = node.type;
  view.setAttribute("aria-pressed", String(model.selected === node.id));
  view.dataset.selected = String(model.selected === node.id);
  view.dataset.active = String(latest?.nodeId === node.id && model.running);
  view.setAttribute("aria-label", `Edit ${node.label}`);
  view.style.left = `${position.x}px`;
  view.style.top = `${position.y}px`;

  view.append(
    element({
      className: "node-kicker",
      text: `${executionLabel({ model, node })} / ${node.type.toUpperCase()}`,
    }),
    header,
  );

  view.onclick = () => {
    model.selected = node.id;
    model.tab = "node";
    model.inspectedEvent = null;
    model.redraw();
  };

  return view;
}

export function drawCanvas({ model }: CanvasInput) {
  const nodes = byId({ id: "nodes" });
  const edges = document.getElementById("edges")!;

  nodes.replaceChildren(
    ...model.graph.nodes.map((node) => nodeView({ model, node })),
  );

  edges.replaceChildren(
    edgeMarkers(),
    ...model.graph.edges
      .map((edge) => edgeView({ model, edge }))
      .filter((edge) => edge !== null),
  );

  const { x, y, zoom } = model.viewport;

  byId({ id: "stage" }).style.transform =
    `translate(${x}px, ${y}px) scale(${zoom})`;

  byId({ id: "zoom-value" }).textContent = `${Math.round(zoom * 100)}%`;

  byId({ id: "graph-count" }).textContent =
    `${model.graph.nodes.length} NODES / ${model.graph.edges.length} EDGES`;
}

export function fitCanvas({ model }: CanvasInput) {
  const canvas = byId({ id: "canvas" });
  const positions = Object.values(model.graph.layout);
  const minX = Math.min(0, ...positions.map((position) => position.x));
  const minY = Math.min(0, ...positions.map((position) => position.y));

  const width =
    Math.max(400, ...positions.map((position) => position.x + 260)) - minX;

  const height =
    Math.max(300, ...positions.map((position) => position.y + 150)) - minY;

  const zoom = Math.max(
    0.2,
    Math.min(
      1,
      (canvas.clientWidth - 70) / width,
      (canvas.clientHeight - 100) / height,
    ),
  );

  model.viewport = { x: 30 - minX * zoom, y: 55 - minY * zoom, zoom };
  drawCanvas({ model });
}
