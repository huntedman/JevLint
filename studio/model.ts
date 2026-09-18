import type { Workflow } from "#jevlint/graph/schema.ts";
import type { RunEvent } from "#jevlint/graph/trace.ts";

export interface StudioModel {
  graph: Workflow;
  selected: string;
  tab: (typeof inspectorTabs)[keyof typeof inspectorTabs];
  events: RunEvent[];
  inspectedEvent: RunEvent | null;
  running: boolean;
  controller: AbortController | null;
  viewport: Viewport;
  redraw: () => void;
}

export interface Position {
  x: number;
  y: number;
}

interface Viewport extends Position {
  zoom: number;
}

interface ModelInput {
  model: StudioModel;
}

interface DownloadInput {
  name: string;
  text: string;
}

interface LookupInput<T extends HTMLElement> {
  id: string;
  type?: new () => T;
}

interface PositionInput extends ModelInput {
  nodeId: string;
}

interface ElementInput {
  tag?: string;
  className?: string;
  text?: string;
}

interface NoticeInput {
  message: string;
  error?: boolean;
}

export const inspectorTabs = {
  node: "node",
  state: "state",
  format: "format",
} as const;

export const storageKey = "jev-studio.graph.v1";

export function element({
  tag = "div",
  className = "",
  text = "",
}: ElementInput): HTMLElement {
  const node = document.createElement(tag);

  node.className = className;
  node.textContent = text;

  return node;
}

export function byId<T extends HTMLElement = HTMLElement>({
  id,
  type,
}: LookupInput<T>): T {
  const node = document.getElementById(id);

  if (!node || (type && !(node instanceof type)))
    throw new Error(`Missing UI element: ${id}`);

  return node as T;
}

export function notice({ message, error = false }: NoticeInput) {
  const node = byId({ id: "notice" });

  node.textContent = message;
  node.dataset.error = String(error);
}

export function save({ model }: ModelInput) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(model.graph));
    byId({ id: "save-status" }).textContent = "Saved locally";
  } catch {
    byId({ id: "save-status" }).textContent = "Export to save";

    notice({
      message:
        "Browser storage is unavailable or full. Export your graph to save it.",
      error: true,
    });
  }
}

export function download({ name, text }: DownloadInput) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );

  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function nodePosition({ model, nodeId }: PositionInput): Position {
  if (Object.hasOwn(model.graph.layout, nodeId))
    return model.graph.layout[nodeId];

  return { x: 100, y: 100 };
}

export function saveDefinition({ model }: ModelInput) {
  model.events = [];
  model.inspectedEvent = null;
  save({ model });
}
