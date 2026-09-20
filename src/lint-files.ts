import {
  createCacheKey,
  readCachedJudgments,
  writeCachedJudgments,
} from "#jevlint/judgment-cache.ts";
import { relative } from "node:path";
import { createRequest, evaluateFile } from "#jevlint/jev-client.ts";
import { readSource } from "#jevlint/source-files.ts";
import { selectPlugins } from "#jevlint/plugins.ts";
import type { ScopedPlugin } from "#jevlint/plugins.ts";
import type { Judgment } from "#jevlint/jev-client.ts";

export type FileResult =
  | {
      filePath: string;
      status: typeof fileStatus.analyzed;
      judgments: Judgment[];
      cached?: true;
    }
  | { filePath: string; status: typeof fileStatus.failed; error: string }
  | { filePath: string; status: typeof fileStatus.skipped };

type PreparedRequest = ReturnType<typeof createRequest>;

type FileOutcome =
  FileResult | { status: typeof fileStatus.prepared; request: PreparedRequest };

interface LintFileInput extends Omit<LintFilesInput, "files"> {
  absolutePath: string;
}

export type ProgressWriter = (input: ProgressInput) => void;

interface ProgressInput {
  text: string;
}

interface LintFilesInput {
  cwd: string;
  files: readonly string[];
  apiKey: string;
  model: string;
  dryRun: boolean;
  cache?: boolean;
  directory: string;
  plugins: readonly ScopedPlugin[];
  timeoutMs: number;
  maxFileBytes: number;
  writeProgress?: ProgressWriter;
}

export const fileStatus = {
  analyzed: "analyzed",
  failed: "failed",
  skipped: "skipped",
  prepared: "prepared",
} as const;

export async function lintFiles({ files, ...input }: LintFilesInput) {
  const results: FileResult[] = [];
  const requests: PreparedRequest[] = [];

  for (const absolutePath of files) {
    const outcome = await lintFile({ absolutePath, ...input });

    if (outcome.status === fileStatus.prepared) requests.push(outcome.request);
    else results.push(outcome);
  }

  return { results, requests };
}

async function lintFile(input: LintFileInput): Promise<FileOutcome> {
  const filePath = relative(input.cwd, input.absolutePath);

  const plugins = selectPlugins({
    directory: input.directory,
    filePath: input.absolutePath,
    plugins: input.plugins,
  });

  if (plugins.length === 0) return { filePath, status: fileStatus.skipped };

  try {
    const source = await readSource({
      filePath: input.absolutePath,
      maxFileBytes: input.maxFileBytes,
    });

    const request = { filePath, source, model: input.model, plugins };

    if (input.dryRun) {
      input.writeProgress?.({ text: `Jevlint: preparing ${filePath}\n` });
      return { status: fileStatus.prepared, request: createRequest(request) };
    }

    const key = createCacheKey({
      request: createRequest(request),
      messages: plugins.map((plugin) => plugin.message),
    });
    const cached =
      input.cache === false
        ? undefined
        : await readCachedJudgments({
            cwd: input.cwd,
            key,
            pluginIds: plugins.map((plugin) => plugin.id),
          });

    input.writeProgress?.({
      text: `Jevlint: ${cached ? "cached" : "analyzing"} ${filePath}\n`,
    });

    if (cached)
      return {
        filePath,
        status: fileStatus.analyzed,
        judgments: cached,
        cached: true,
      };

    const judgments = await evaluateFile({
      ...request,
      apiKey: input.apiKey,
      timeoutMs: input.timeoutMs,
    });

    if (input.cache !== false)
      await writeCachedJudgments({ cwd: input.cwd, key, judgments });

    return { filePath, status: fileStatus.analyzed, judgments };
  } catch (error) {
    return {
      filePath,
      status: fileStatus.failed,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
