import { fileStatus } from "#jevlint/lint-files.ts";
import type { FileResult } from "#jevlint/lint-files.ts";

interface ReportInput {
  results: readonly FileResult[];
  threshold: number;
  model: string;
  format: string;
  pluginIds: readonly string[];
}

export function report({
  results,
  threshold,
  model,
  format,
  pluginIds,
}: ReportInput) {
  const flagged = results
    .filter((result) => result.status === fileStatus.analyzed)
    .flatMap((result) =>
      result.judgments
        .filter((judgment) => judgment.probability >= threshold)
        .map((judgment) => ({ filePath: result.filePath, ...judgment })),
    );

  const failed = results.filter(
    (result) => result.status === fileStatus.failed,
  );

  const summary = {
    files: results.length,
    flagged: new Set(flagged.map((finding) => finding.filePath)).size,
    failed: failed.length,
    skipped: results.filter((result) => result.status === fileStatus.skipped)
      .length,
  };

  const lines = flagged.map(
    (result) =>
      `${result.filePath}: warning [${result.pluginId}] ${result.message} (probability ${result.probability.toFixed(3)})`,
  );

  lines.push(
    `Jevlint: ${summary.files} files, ${summary.flagged} flagged, ${summary.failed} failed, ${summary.skipped} skipped (threshold ${threshold}).`,
  );

  const data = { plugins: pluginIds, model, threshold, results, summary };

  let exitCode = flagged.length > 0 ? 1 : 0;

  if (failed.length > 0) exitCode = 2;

  return {
    stdout:
      format === "json"
        ? `${JSON.stringify(data, null, 2)}\n`
        : `${lines.join("\n")}\n`,
    stderr: failed
      .map((result) => `${result.filePath}: ${result.error}\n`)
      .join(""),
    exitCode,
  };
}
