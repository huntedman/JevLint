import { fileStatus } from "#jevlint/lint-files.ts";
import type { FileResult } from "#jevlint/lint-files.ts";
import { stripVTControlCharacters } from "node:util";

const textStyles = {
  title: 1,
  muted: 2,
  success: 32,
  warning: 33,
  error: 31,
  path: 36,
} as const;

export function styleOutput(
  text: string,
  style: keyof typeof textStyles,
  color: boolean,
) {
  const plain = stripVTControlCharacters(text);
  return color ? `\u001b[${textStyles[style]}m${plain}\u001b[0m` : plain;
}

interface ReportInput {
  results: readonly FileResult[];
  threshold: number;
  model: string;
  format: string;
  pluginIds: readonly string[];
  color?: boolean;
  prettyPrint?: boolean;
}

export function report({
  results,
  threshold,
  model,
  format,
  pluginIds,
  color = false,
  prettyPrint = true,
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

  const data = { plugins: pluginIds, model, threshold, results, summary };

  let exitCode = flagged.length > 0 ? 1 : 0;

  if (failed.length > 0) exitCode = 2;

  if (format === "json")
    return {
      stdout: `${JSON.stringify(data, null, 2)}\n`,
      stderr: "",
      exitCode,
    };

  const errors = failed
    .map((result) => `${result.filePath}: ${result.error}\n`)
    .join("");
  if (!prettyPrint) {
    const lines = flagged.map(
      (finding) =>
        `${finding.filePath}: warning [${finding.pluginId}] ${finding.message} (probability ${finding.probability.toFixed(3)})`,
    );
    lines.push(
      `Jevlint: ${summary.files} files, ${summary.flagged} flagged, ${summary.failed} failed, ${summary.skipped} skipped (threshold ${threshold}).`,
    );
    return {
      stdout: `${stripVTControlCharacters(lines.join("\n"))}\n`,
      stderr: stripVTControlCharacters(errors),
      exitCode,
    };
  }

  const lines = [
    styleOutput("JevLint", "title", color),
    styleOutput(
      `Model: ${model} | Threshold: ${(threshold * 100).toFixed(1)}%`,
      "muted",
      color,
    ),
    "",
  ];

  for (const result of results) {
    if (result.status !== fileStatus.analyzed) continue;
    const findings = result.judgments.filter(
      (finding) => finding.probability >= threshold,
    );
    if (!findings.length) continue;
    lines.push(styleOutput(result.filePath, "path", color));
    for (const finding of findings) {
      lines.push(
        `  ${styleOutput("warning", "warning", color)} [${styleOutput(finding.pluginId, "muted", color)}]  Probability: ${(finding.probability * 100).toFixed(1)}%`,
        `    ${styleOutput(finding.message, "muted", color)}`,
      );
    }
    lines.push("");
  }

  const heading =
    failed.length > 0
      ? "Analysis incomplete"
      : flagged.length > 0
        ? "Findings detected"
        : summary.skipped === summary.files
          ? "No files analyzed"
          : "No findings";
  const headingStyle =
    failed.length > 0
      ? "error"
      : flagged.length > 0 || summary.skipped === summary.files
        ? "warning"
        : "success";
  lines.push(
    styleOutput(heading, headingStyle, color),
    `  ${summary.files} ${summary.files === 1 ? "file" : "files"} | ${summary.flagged} flagged | ${summary.failed} failed | ${summary.skipped} skipped`,
  );

  return {
    stdout: `${lines.join("\n")}\n`,
    stderr: errors,
    exitCode,
  };
}
