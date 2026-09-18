import { z } from "zod";
import type { JudgmentNode, State } from "#jevlint/graph/schema.ts";

export type Judgment = z.infer<typeof judgmentSchema>;

interface EvaluateInput {
  node: JudgmentNode;
  state: State;
  results: Record<string, Judgment>;
  model: string;
  timeoutMs: number;
  signal: AbortSignal;
}

export type Evaluator = (input: EvaluateInput) => Promise<Judgment>;

interface ValidateAnswerInput {
  node: JudgmentNode;
  value: unknown;
}

interface ChoiceTag {
  type: "choice";
}

interface DistributionInput {
  node: Extract<JudgmentNode, ChoiceTag>;
  answer: Extract<Judgment, ChoiceTag>;
}

interface LiveEvaluatorInput {
  apiKey: string;
  request?: typeof fetch;
}

const probability = z.number().min(0).max(1);

export const judgmentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    probabilities: z.record(z.string(), probability),
    confidence: probability,
  }),
  z.object({ type: z.literal("noul"), noul: probability }),
]);

const responseSchema = z.object({ answers: z.record(z.string(), z.unknown()) });

function validateDistribution({ node, answer }: DistributionInput) {
  const keys = Object.keys(node.criteria);
  const probabilities = answer.probabilities;

  const sum = Object.values(probabilities).reduce(
    (total, value) => total + value,
    0,
  );

  if (
    keys.length !== Object.keys(probabilities).length ||
    !keys.every((key) => Object.hasOwn(probabilities, key))
  )
    throw new Error("Jev returned a different option set.");

  if (!keys.includes(answer.choice) || Math.abs(sum - 1) > 0.01)
    throw new Error("Jev returned an invalid probability distribution.");

  if (
    keys.some(
      (key) => probabilities[key] > probabilities[answer.choice] + 0.000001,
    )
  )
    throw new Error("Jev choice does not match its highest probability.");
}

export function validateAnswer({ node, value }: ValidateAnswerInput): Judgment {
  const answer = judgmentSchema.parse(value);

  if (answer.type !== node.type)
    throw new Error("Jev returned the wrong answer type.");

  if (answer.type === "choice" && node.type === "choice")
    validateDistribution({ node, answer });

  return answer;
}

export function liveEvaluator({
  apiKey,
  request = fetch,
}: LiveEvaluatorInput): Evaluator {
  return async ({ node, state, results, model, timeoutMs, signal }) => {
    if (!apiKey)
      throw new Error("Set JEV_API_KEY on the server before a live run.");

    const question =
      node.type === "choice"
        ? {
            type: node.type,
            instructions: node.instructions,
            criteria: node.criteria,
          }
        : { type: node.type, instructions: node.instructions };

    const response = await request("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        state: { context: state, results },
        questions: { [node.id]: question },
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    });

    if (!response.ok) throw new Error(`Jev returned HTTP ${response.status}.`);

    const body = responseSchema.parse(await response.json());

    return validateAnswer({ node, value: body.answers[node.id] });
  };
}
