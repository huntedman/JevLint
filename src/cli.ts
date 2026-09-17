import { parseArgs, parseEnv } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { discoverFiles } from "#jevlint/source-files.ts";
import { lintFiles } from "#jevlint/lint-files.ts";
import type { ProgressWriter } from "#jevlint/lint-files.ts";
import { report } from "#jevlint/report.ts";
import { loadConfiguration } from "#jevlint/configuration.ts";
import { loadPlugins } from "#jevlint/plugins.ts";

interface CliInput {
  args: string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  writeProgress?: ProgressWriter;
}

const help = `Usage: jevlint [folders, files, or quoted globs] [options]

Recursively judge JavaScript/TypeScript files for magic strings using Jev.
Loads jevlint.config.json from the current directory when present.
Configured paths and plugin scopes are relative to the config file's directory.
CLI targets are relative to the working directory and replace configured files.
Generated/dependency folders and credentials are excluded.
Reads JEV_API_KEY by default and loads .env from the working directory.
Existing environment variables take precedence over .env values.

  --config <path>    Read a specific configuration file
  --threshold <0..1>  Flag files at or above this probability (default: 0.8)
  --model <name>      Jev model (default: jev-latest)
  --format text|json Output format (default: text)
  --ignore <glob>    Add exclusions relative to the config directory; repeatable
  --dry-run         Print request JSON without calling Jev or requiring an API key
  -h, --help        Show help

Example: jevlint apps/backend/src --ignore '**/*.test.ts'
CLI model, threshold, and format override configured values.
Config keys: files, ignore, plugins, model, threshold, format, apiKeyEnv,
timeoutMs, maxFileBytes. Plugins accept a name/path or { path, files, ignore }.
Use magic-strings or a directory containing index.ts/index.mjs exporting plugin
with id, instructions (a NOUL question), and message.
Findings are file-level probabilities, not line-level diagnostics.
Exit codes: 0 = no findings, 1 = findings, 2 = configuration or analysis failure.
`;

const optionsSchema = z.object({
  threshold: z
    .string()
    .trim()
    .min(1)
    .transform(Number)
    .pipe(z.number().min(0).max(1))
    .optional(),
  model: z.string().trim().min(1).optional(),
  format: z.enum(["text", "json"]).optional(),
  ignore: z.array(z.string().trim().min(1)).optional(),
});

function parseOptions({ args }: Pick<CliInput, "args">) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      config: { type: "string" },
      threshold: { type: "string" },
      model: { type: "string" },
      format: { type: "string" },
      ignore: { type: "string", multiple: true },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
}

async function execute({ args, cwd, environment, writeProgress }: CliInput) {
  const { values, positionals } = parseOptions({ args });

  if (values.help) return { stdout: help, stderr: "", exitCode: 0 };

  const { configuration, directory } = await loadConfiguration({
    cwd,
    configPath: values.config,
    overrides: optionsSchema.parse(values),
  });

  const envFile = await readFile(resolve(cwd, ".env"), "utf8").catch(
    (error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return "";

      throw error;
    },
  );
  const fileEnvironment = parseEnv(envFile);
  const apiKey = (
    environment[configuration.apiKeyEnv] ??
    fileEnvironment[configuration.apiKeyEnv] ??
    ""
  ).trim();
  const dryRun = values["dry-run"] === true;

  if (!dryRun && !apiKey)
    throw new Error(
      `Set ${configuration.apiKeyEnv} in your environment or .env file.`,
    );

  const plugins = await loadPlugins({
    directory,
    registrations: configuration.plugins,
  });

  const files = await discoverFiles({
    cwd: directory,
    targets: positionals.length
      ? positionals.map((target) => resolve(cwd, target))
      : configuration.files,
    ignore: configuration.ignore,
  });

  const { results, requests } = await lintFiles({
    cwd,
    files,
    apiKey,
    model: configuration.model,
    dryRun,
    plugins,
    directory,
    timeoutMs: configuration.timeoutMs,
    maxFileBytes: configuration.maxFileBytes,
    writeProgress,
  });

  const result = report({
    results,
    ...configuration,
    pluginIds: plugins.map((plugin) => plugin.id),
  });

  if (dryRun)
    result.stdout = `${JSON.stringify({ requests, results }, null, 2)}\n`;

  return result;
}

export async function runCli(input: CliInput) {
  try {
    return await execute(input);
  } catch (error) {
    return {
      stdout: "",
      stderr: `jevlint: ${error instanceof Error ? error.message : String(error)}\n`,
      exitCode: 2,
    };
  }
}
