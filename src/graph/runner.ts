import { parseWorkflow } from "#jevlint/graph/schema.ts";
import { validateAnswer } from "#jevlint/graph/judgment.ts";
import type {
  Workflow,
  WorkflowNode,
  JudgmentNode,
  State,
} from "#jevlint/graph/schema.ts";
import type { Evaluator, Judgment } from "#jevlint/graph/judgment.ts";
import type { RunEvent, RunMode, EventPayload } from "#jevlint/graph/trace.ts";

export interface RunInput {
  graph: Workflow;
  evaluate: Evaluator;
  signal: AbortSignal;
  mode: RunMode;
  emit: (event: RunEvent) => Promise<void>;
}

type StepOutput = string | null;

interface NodeInput {
  node: WorkflowNode;
}

interface JudgmentInput {
  node: JudgmentNode;
}

interface FailureInput {
  error: unknown;
}

class WorkflowRun {
  private readonly graph: Workflow;
  private readonly state: State;
  private readonly results: Record<string, Judgment> = Object.create(null);
  private sequence = 0;
  private nodeId: string;
  private readonly input: RunInput;

  constructor(input: RunInput) {
    this.input = input;
    this.graph = parseWorkflow({ value: input.graph });
    this.state = structuredClone(this.graph.state);
    this.nodeId = this.graph.entry;
  }

  private async send(event: EventPayload) {
    await this.input.emit({
      ...event,
      version: 1,
      sequence: this.sequence++,
      at: new Date().toISOString(),
    });
  }

  private async judge({ node }: JudgmentInput): Promise<StepOutput> {
    const { evaluate, signal } = this.input;
    const started = performance.now();

    const answer = validateAnswer({
      node,
      value: await evaluate({
        node,
        state: structuredClone(this.state),
        results: structuredClone(this.results),
        model: this.graph.model,
        timeoutMs: this.graph.timeoutMs,
        signal,
      }),
    });

    signal.throwIfAborted();
    this.results[node.id] = answer;

    await this.send({
      type: "judgment",
      nodeId: node.id,
      answer,
      elapsedMs: Math.round(performance.now() - started),
    });

    if (node.type === "noul" && answer.type === "noul")
      return answer.noul >= node.threshold ? "yes" : "no";

    if (node.type !== "choice" || answer.type !== "choice")
      throw new Error("Unexpected judgment type.");

    if (answer.confidence < node.minConfidence) {
      await this.send({
        type: "paused",
        nodeId: node.id,
        message: `Confidence ${answer.confidence.toFixed(3)} is below ${node.minConfidence}. Review before starting a new run.`,
      });

      return null;
    }

    return answer.choice;
  }

  private async execute({ node }: NodeInput): Promise<StepOutput> {
    this.input.signal.throwIfAborted();

    if (node.type === "end") {
      await this.send({
        type: "completed",
        nodeId: node.id,
        message: node.output,
        state: structuredClone(this.state),
      });

      return null;
    }

    if (node.type === "input" || node.type === "set-state") {
      for (const [key, value] of Object.entries(node.values))
        Object.defineProperty(this.state, key, {
          value: structuredClone(value),
          writable: true,
          enumerable: true,
          configurable: true,
        });

      await this.send({
        type: "state-updated",
        nodeId: node.id,
        state: structuredClone(this.state),
      });

      return "next";
    }

    return this.judge({ node });
  }

  private async fail({ error }: FailureInput) {
    const message = error instanceof Error ? error.message : "Run failed.";

    await this.send({
      type: this.input.signal.aborted ? "cancelled" : "error",
      nodeId: this.nodeId,
      message: this.input.signal.aborted ? "Run stopped." : message,
    });
  }

  async run(): Promise<void> {
    await this.send({
      type: "started",
      graph: this.graph,
      state: structuredClone(this.state),
      mode: this.input.mode,
    });

    try {
      for (let step = 0; step < this.graph.maxSteps; step++) {
        this.input.signal.throwIfAborted();

        const node = this.graph.nodes.find(
          (candidate) => candidate.id === this.nodeId,
        )!;

        await this.send({
          type: "node-started",
          nodeId: node.id,
          state: structuredClone(this.state),
        });

        const output = await this.execute({ node });

        if (output === null) return;

        this.input.signal.throwIfAborted();

        const edge = this.graph.edges.find(
          (candidate) =>
            candidate.source === node.id && candidate.output === output,
        )!;

        await this.send({
          type: "transition",
          nodeId: node.id,
          edgeId: edge.id,
        });

        this.nodeId = edge.target;
      }

      await this.send({
        type: "limit",
        nodeId: this.nodeId,
        message: `Stopped at the ${this.graph.maxSteps}-step limit.`,
      });
    } catch (error) {
      await this.fail({ error });
    }
  }
}

export async function runWorkflow(input: RunInput): Promise<void> {
  await new WorkflowRun(input).run();
}
