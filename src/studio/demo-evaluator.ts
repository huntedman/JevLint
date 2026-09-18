import { setTimeout } from "node:timers/promises";
import type { Evaluator } from "#jevlint/graph/judgment.ts";

export const demoEvaluator: Evaluator = async ({ node, signal }) => {
  await setTimeout(700, undefined, { signal });

  if (node.type === "noul") return { type: "noul", noul: 0.91 };

  const keys = Object.keys(node.criteria);
  const choice = keys[0];

  const probabilities = Object.fromEntries(
    keys.map((key) => [key, key === choice ? 0.84 : 0.16 / (keys.length - 1)]),
  );

  return { type: "choice", choice, probabilities, confidence: 0.76 };
};
