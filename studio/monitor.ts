import { byId, element } from "#studio/model.ts";
import type { StudioModel } from "#studio/model.ts";
import type { RunEvent } from "#jevlint/graph/trace.ts";

interface MonitorInput {
  model: StudioModel;
}

interface EventInput extends MonitorInput {
  event: RunEvent;
}

interface EventSummaryInput {
  event: RunEvent;
}

interface ProbabilityRowInput {
  name: string;
  value: number;
}

type SelectedEvent = RunEvent | undefined;

function eventSummary({ event }: EventSummaryInput): string {
  if (event.answer?.type === "choice") return event.answer.choice;

  if (event.answer?.type === "noul")
    return `P(yes) ${(event.answer.noul * 100).toFixed(1)}%`;

  return event.message ?? event.edgeId ?? "";
}

function eventRow({ model, event }: EventInput): HTMLElement {
  const row = element({ tag: "button", className: "trace-event" });

  const node = model.graph.nodes.find(
    (candidate) => candidate.id === event.nodeId,
  );

  row.append(
    element({
      className: "trace-time",
      text: new Date(event.at).toLocaleTimeString("en-GB", { hour12: false }),
    }),
    element({ className: "trace-type", text: event.type.toUpperCase() }),
    element({ className: "trace-node", text: node?.label ?? model.graph.name }),
    element({ className: "trace-result", text: eventSummary({ event }) }),
  );

  row.onclick = () => {
    if (!event.nodeId) return;

    model.selected = event.nodeId;
    model.tab = "node";
    model.inspectedEvent = event;
    model.redraw();
  };

  return row;
}

function selectedJudgment({ model }: MonitorInput): SelectedEvent {
  if (
    model.inspectedEvent?.nodeId === model.selected &&
    model.inspectedEvent.answer
  )
    return model.inspectedEvent;

  return model.events.findLast(
    (candidate) =>
      candidate.nodeId === model.selected && candidate.type === "judgment",
  );
}

function probabilityRow({ name, value }: ProbabilityRowInput): HTMLElement {
  const row = element({ className: "probability-row" });
  const track = element({ className: "probability-track" });
  const bar = element({ className: "probability-bar" });

  bar.style.width = `${value * 100}%`;
  track.append(bar);

  row.append(
    element({ text: name }),
    element({ text: `${(value * 100).toFixed(1)}%` }),
    track,
  );

  return row;
}

function judgmentMetadata({ model, event }: EventInput): HTMLElement {
  const confidence =
    event.answer?.type === "choice"
      ? `Confidence ${event.answer.confidence.toFixed(3)} · `
      : "";

  const mode = model.events[0]?.mode === "demo" ? "SIMULATED" : "LIVE";

  return element({
    className: "judgment-meta",
    text: `${confidence}${event.elapsedMs ?? 0} ms · ${mode}`,
  });
}

export function judgmentCard({ model }: MonitorInput): HTMLElement {
  const card = element({ className: "judgment-card" });
  const event = selectedJudgment({ model });
  const answer = event?.answer;

  if (!answer) return card;

  card.append(
    element({
      className: "section-label",
      text: `JUDGMENT / EVENT ${event.sequence}`,
    }),
  );

  const probabilities =
    answer.type === "choice"
      ? answer.probabilities
      : { yes: answer.noul, no: 1 - answer.noul };

  for (const [name, value] of Object.entries(probabilities))
    card.append(probabilityRow({ name, value }));

  card.append(judgmentMetadata({ model, event }));

  return card;
}

function updateMetrics({ model }: MonitorInput) {
  const judgments = model.events.filter((event) => event.type === "judgment");

  const active = model.events.findLast(
    (event) => event.type === "node-started",
  );

  byId({ id: "metric-calls" }).textContent = String(judgments.length).padStart(
    2,
    "0",
  );

  byId({ id: "metric-latency" }).textContent = judgments.length
    ? `${judgments.at(-1)?.elapsedMs} ms`
    : "—";

  byId({ id: "metric-node" }).textContent = active?.nodeId ?? "—";

  byId({ id: "metric-mode" }).textContent =
    model.events[0]?.mode === "live" ? "LIVE JEV" : "SIMULATION";
}

export function drawMonitor({ model }: MonitorInput) {
  updateMetrics({ model });

  const last = model.events.at(-1);

  byId({ id: "run-status" }).textContent = model.running
    ? "RUNNING"
    : (last?.type.toUpperCase() ?? "IDLE");

  byId({ id: "run", type: HTMLButtonElement }).disabled = model.running;
  byId({ id: "stop", type: HTMLButtonElement }).disabled = !model.running;

  byId({ id: "export-run", type: HTMLButtonElement }).disabled =
    !model.events.length;

  byId({ id: "mode", type: HTMLSelectElement }).disabled = model.running;

  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-add], #example, #import, #new-graph",
  ))
    button.disabled = model.running;

  const timeline = byId({ id: "timeline" });

  if (!model.events.length) {
    timeline.replaceChildren(
      element({
        className: "empty-trace",
        text: "No decisions yet. Run the graph and follow the signal.",
      }),
    );

    return;
  }

  timeline.replaceChildren(
    ...model.events.slice(-100).map((event) => eventRow({ model, event })),
  );

  timeline.scrollTop = timeline.scrollHeight;
}
