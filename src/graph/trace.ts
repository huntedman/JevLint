import { z } from "zod";
import { workflowSchema } from "#jevlint/graph/schema.ts";
import { judgmentSchema } from "#jevlint/graph/judgment.ts";

export type RunEvent = z.infer<typeof eventSchema>;
export type RunMode = z.infer<typeof runModeSchema>;
export type EventPayload = Omit<RunEvent, "version" | "sequence" | "at">;
export const runModeSchema = z.enum(["live", "demo"]);
export const eventSchema = z.object({
  version: z.literal(1),
  sequence: z.number().int().nonnegative(),
  at: z.iso.datetime(),
  type: z.enum([
    "started",
    "node-started",
    "judgment",
    "transition",
    "state-updated",
    "completed",
    "paused",
    "error",
    "cancelled",
    "limit",
  ]),
  nodeId: z.string().optional(),
  edgeId: z.string().optional(),
  answer: judgmentSchema.optional(),
  elapsedMs: z.number().nonnegative().optional(),
  message: z.string().optional(),
  state: z.record(z.string(), z.json()).optional(),
  graph: workflowSchema.optional(),
  mode: runModeSchema.optional(),
});
