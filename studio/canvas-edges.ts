import { nodeOutputs } from "#jevlint/graph/schema.ts";
import { nodePosition } from "#studio/model.ts";
import type { StudioModel } from "#studio/model.ts";
import type { WorkflowEdge } from "#jevlint/graph/schema.ts";

interface EdgeViewInput {
  model: StudioModel;
  edge: WorkflowEdge;
}

interface LabelInput {
  edge: WorkflowEdge;
  x: number;
  y: number;
}

type EdgeElement = SVGElement | null;

const routeArrow = "route-arrow";
const namespace = "http://www.w3.org/2000/svg";

export function edgeMarkers(): SVGDefsElement {
  const definitions = document.createElementNS(namespace, "defs");

  for (const id of [routeArrow, "active-route-arrow"]) {
    const marker = document.createElementNS(namespace, "marker");
    const arrow = document.createElementNS(namespace, "path");

    marker.id = id;
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "8");
    marker.setAttribute("markerHeight", "8");
    marker.setAttribute("orient", "auto-start-reverse");
    arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    arrow.setAttribute("fill", id === routeArrow ? "#738975" : "#b9ef82");
    marker.append(arrow);
    definitions.append(marker);
  }

  return definitions;
}

export function edgeView({ model, edge }: EdgeViewInput): EdgeElement {
  const source = model.graph.nodes.find((node) => node.id === edge.source);

  if (!source) return null;

  const outputs = nodeOutputs({ node: source });
  const from = nodePosition({ model, nodeId: edge.source });
  const to = nodePosition({ model, nodeId: edge.target });
  const x = from.x + 220;

  const y =
    from.y +
    18 +
    ((outputs.indexOf(edge.output) + 1) * 54) / (outputs.length + 1);

  const targetY = to.y + 45;
  const bend = Math.max(70, Math.abs(to.x - x) * 0.45);
  const group = document.createElementNS(namespace, "g");
  const path = document.createElementNS(namespace, "path");

  const selected = model.events.some(
    (event) => event.type === "transition" && event.edgeId === edge.id,
  );

  path.setAttribute(
    "d",
    `M ${x} ${y} C ${x + bend} ${y}, ${to.x - bend} ${targetY}, ${to.x - 3} ${targetY}`,
  );

  path.setAttribute("class", selected ? "graph-edge traversed" : "graph-edge");

  path.setAttribute(
    "marker-end",
    `url(#${selected ? "active-route-arrow" : routeArrow})`,
  );

  group.append(path, edgeLabel({ edge, x, y }));

  return group;
}

function edgeLabel({ edge, x, y }: LabelInput): SVGTextElement {
  const label = document.createElementNS(namespace, "text");

  label.setAttribute("x", String(x + 12));
  label.setAttribute("y", String(y - 6));
  label.setAttribute("class", "edge-label");
  label.textContent = edge.output.replaceAll("_", " ");

  return label;
}
