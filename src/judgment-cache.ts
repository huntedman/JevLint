import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { createRequest, Judgment } from "#jevlint/jev-client.ts";

interface CacheKeyInput {
  request: ReturnType<typeof createRequest>;
  messages: readonly string[];
}

interface CacheLocation {
  cwd: string;
  key: string;
}

interface ReadCacheInput extends CacheLocation {
  pluginIds: readonly string[];
}

interface WriteCacheInput extends CacheLocation {
  judgments: readonly Judgment[];
}

const cachedJudgmentsSchema = z.array(
  z.object({
    pluginId: z.string(),
    probability: z.number().min(0).max(1),
    message: z.string(),
  }),
);

export function createCacheKey({ request, messages }: CacheKeyInput) {
  return createHash("sha256")
    .update(JSON.stringify({ version: 1, request, messages }))
    .digest("hex");
}

export async function readCachedJudgments({
  cwd,
  key,
  pluginIds,
}: ReadCacheInput): Promise<Judgment[] | undefined> {
  try {
    const directory = join(cwd, ".jevlint");

    if (!(await lstat(directory)).isDirectory()) return undefined;

    const file = await open(
      join(directory, `${key}.json`),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );

    try {
      const judgments = cachedJudgmentsSchema.parse(
        JSON.parse(await file.readFile("utf8")),
      );

      if (
        judgments.length !== pluginIds.length ||
        judgments.some(
          (judgment, index) => judgment.pluginId !== pluginIds[index],
        )
      )
        return undefined;

      return judgments;
    } finally {
      await file.close();
    }
  } catch {
    return undefined;
  }
}

export async function writeCachedJudgments({
  cwd,
  key,
  judgments,
}: WriteCacheInput): Promise<void> {
  const directory = join(cwd, ".jevlint");
  const temporaryPath = join(directory, `${key}.${randomUUID()}.tmp`);

  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });

    if (!(await lstat(directory)).isDirectory()) return;

    await writeFile(temporaryPath, JSON.stringify(judgments), {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, join(directory, `${key}.json`));
  } catch {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
