import { z } from "zod";
import type { LintPlugin } from "#jevlint/plugins.ts";

export interface Judgment {
  pluginId: string;
  probability: number;
  message: string;
}

interface CreateRequestInput {
  filePath: string;
  source: string;
  model: string;
  plugins: readonly LintPlugin[];
}

interface EvaluateFileInput extends CreateRequestInput {
  apiKey: string;
  timeoutMs: number;
}

const responseSchema = z.object({ answers: z.record(z.string(), z.unknown()) });

const answerSchema = z.object({
  type: z.literal("noul"),
  noul: z.number().min(0).max(1),
});

export function createRequest({
  filePath,
  source,
  model,
  plugins,
}: CreateRequestInput) {
  return {
    model,
    state: { filePath, source },
    questions: Object.fromEntries(
      plugins.map((plugin) => [
        plugin.id,
        { type: "noul", instructions: plugin.instructions },
      ]),
    ),
  };
}

export async function evaluateFile({
  apiKey,
  timeoutMs,
  ...input
}: EvaluateFileInput): Promise<Judgment[]> {
  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createRequest(input)),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok)
    throw new Error(
      `Jev API returned HTTP ${response.status}: ${await response.text()}`,
    );

  const responseData = responseSchema.parse(await response.json());

  return input.plugins.map((plugin) => {
    const parsed = answerSchema.safeParse(responseData.answers[plugin.id]);

    if (!parsed.success)
      throw new Error(`Jev returned an invalid ${plugin.id} NOUL answer.`);

    return {
      pluginId: plugin.id,
      probability: parsed.data.noul,
      message: plugin.message,
    };
  });
}
