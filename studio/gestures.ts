import { byId, save, nodePosition } from "#studio/model.ts";
import { orderedLayout } from "#studio/flow-layout.ts";
import { drawCanvas, fitCanvas } from "#studio/canvas.ts";
import type { StudioModel } from "#studio/model.ts";

interface GestureInput {
  model: StudioModel;
}

interface Drag {
  pointer: number;
  clientX: number;
  clientY: number;
  x: number;
  y: number;
  nodeId?: string;
}

interface PointerInput {
  event: PointerEvent;
}

class CanvasGestures {
  private readonly model: StudioModel;
  private readonly canvas = byId({ id: "canvas" });
  private drag: Drag | null = null;

  constructor({ model }: GestureInput) {
    this.model = model;
  }

  private start({ event }: PointerInput) {
    if (
      event.button !== 0 ||
      !(event.target instanceof Element) ||
      event.target.closest(".canvas-bottom")
    )
      return;

    const nodeId =
      event.target.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;

    if (nodeId && this.model.running) {
      this.model.selected = nodeId;
      this.model.tab = "node";
      this.model.inspectedEvent = null;
      this.model.redraw();

      return;
    }

    const position = nodeId
      ? nodePosition({ model: this.model, nodeId })
      : this.model.viewport;

    this.drag = {
      pointer: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: position.x,
      y: position.y,
      nodeId,
    };

    this.canvas.setPointerCapture(event.pointerId);
  }

  private move({ event }: PointerInput) {
    const drag = this.drag;

    if (drag?.pointer !== event.pointerId) return;

    const scale = drag.nodeId ? this.model.viewport.zoom : 1;
    const x = drag.x + (event.clientX - drag.clientX) / scale;
    const y = drag.y + (event.clientY - drag.clientY) / scale;

    if (drag.nodeId)
      this.model.graph.layout[drag.nodeId] = {
        x: Math.max(-10000, Math.min(10000, x)),
        y: Math.max(-10000, Math.min(10000, y)),
      };
    else {
      this.model.viewport.x = x;
      this.model.viewport.y = y;
    }

    drawCanvas({ model: this.model });
  }

  private end({ event }: PointerInput) {
    if (!this.drag) return;

    if (this.drag.nodeId) {
      this.model.selected = this.drag.nodeId;
      this.model.tab = "node";
      this.model.inspectedEvent = null;
      save({ model: this.model });
    }

    this.drag = null;
    this.canvas.releasePointerCapture(event.pointerId);
    this.model.redraw();
  }

  bind() {
    this.canvas.onpointerdown = (event) => this.start({ event });
    this.canvas.onpointermove = (event) => this.move({ event });
    this.canvas.onpointerup = (event) => this.end({ event });

    this.canvas.onpointercancel = () => {
      this.drag = null;
    };
  }
}

export function bindGestures({ model }: GestureInput) {
  new CanvasGestures({ model }).bind();

  byId({ id: "arrange" }).onclick = () => {
    model.graph.layout = orderedLayout({ graph: model.graph });
    save({ model });
    model.redraw();
    fitCanvas({ model });
  };

  byId({ id: "fit" }).onclick = () => fitCanvas({ model });

  for (const [id, multiplier] of [
    ["zoom-in", 1.2],
    ["zoom-out", 1 / 1.2],
  ] as const) {
    byId({ id }).onclick = () => {
      model.viewport.zoom = Math.max(
        0.2,
        Math.min(2, model.viewport.zoom * multiplier),
      );

      drawCanvas({ model });
    };
  }
}
