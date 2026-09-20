import { parseArgs, parseEnv } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { discoverFiles } from "#jevlint/source-files.ts";
import { lintFiles } from "#jevlint/lint-files.ts";
import type { ProgressWriter } from "#jevlint/lint-files.ts";
import { report, styleOutput } from "#jevlint/report.ts";
import {
  initializeConfiguration,
  loadConfiguration,
} from "#jevlint/configuration.ts";
import { loadPlugins } from "#jevlint/plugins.ts";

interface CliInput {
  args: string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  writeProgress?: ProgressWriter;
  stdoutIsTTY?: boolean;
  stderrIsTTY?: boolean;
}

interface OutputSettings {
  format: "text" | "json";
  stdoutColor: boolean;
  stderrColor: boolean;
}

const colorMode = { auto: "auto", always: "always", never: "never" } as const;

function useColor(
  mode: (typeof colorMode)[keyof typeof colorMode],
  isTTY: boolean,
  environment: NodeJS.ProcessEnv,
) {
  if (mode === colorMode.always) return true;
  if (mode === colorMode.never || environment.NO_COLOR !== undefined)
    return false;
  if (environment.FORCE_COLOR !== undefined)
    return environment.FORCE_COLOR !== "0";
  return isTTY && environment.TERM !== "dumb";
}

const help = `Usage: jevlint [folders, files, or quoted globs] [options]
       jevlint init [--config <path>]

init creates jevlint.config.json with the magic-strings plugin, without an API key.
Existing configurations are never overwritten. Use ./init to lint a folder named init.

Recursively judge JavaScript/TypeScript files using Jev and configured plugins.
Loads jevlint.config.json from the current directory when present.
Configured paths and plugin scopes are relative to the config file's directory.
CLI targets are relative to the working directory and replace configured files.
Generated/dependency folders and secrets/credentials directories are excluded.
Files named secrets or credentials with any scanned source extension are excluded.
Files outside the working directory, including external symlink targets, are excluded.
Reads JEV_API_KEY by default and loads .env from the working directory.
Existing environment variables take precedence over .env values.
Successful judgments are cached in .jevlint/ in the working repository.
Changes to source, file path, model, or plugin definitions trigger fresh analysis.
Cache hits still report findings using the current threshold. No source or API keys
are stored in cache entries. Dry runs bypass the cache. Delete .jevlint/ to clear it.
Add .jevlint/ to your repository's ignore file.

  --config <path>    Read a specific configuration file
  --threshold <0..1>  Flag files at or above this probability (default: 0.8)
  --model <name>      Jev model (default: jev-latest)
  --format text|json Output format (default: text)
  --color auto|always|never  Terminal colours (default: auto; respects NO_COLOR)
  --ignore <glob>    Add exclusions relative to the config directory; repeatable
  --no-cache        Analyze again without reading or writing .jevlint/ cache entries
  --dry-run         Print request JSON without calling Jev or requiring an API key
                    Still imports and executes configured JavaScript/TypeScript plugins.
                    Only run with plugins you trust; plugin code is not sandboxed.
  -h, --help        Show help

Example: jevlint apps/backend/src --ignore '**/*.test.ts'
CLI model, threshold, and format override configured values.
Config keys: files, ignore, plugins, model, threshold, format, prettyPrint, apiKeyEnv,
timeoutMs, maxFileBytes. Plugins accept a name/path or { path, files, ignore }.
Use magic-strings, descriptive-names, or a directory containing index.ts/index.mjs exporting plugin
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
      color: { type: "string" },
      ignore: { type: "string", multiple: true },
      "dry-run": { type: "boolean" },
      "no-cache": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
}

async function execute(
  {
    args,
    cwd,
    environment,
    writeProgress,
    stdoutIsTTY = false,
    stderrIsTTY = false,
  }: CliInput,
  output: OutputSettings,
) {
  const { values, positionals } = parseOptions({ args });

  if (values.format === "json") output.format = "json";
  const mode = z
    .enum([colorMode.auto, colorMode.always, colorMode.never])
    .parse(values.color ?? colorMode.auto);
  output.stdoutColor = useColor(mode, stdoutIsTTY, environment);
  output.stderrColor = useColor(mode, stderrIsTTY, environment);

  if (values.help) return { stdout: help, stderr: "", exitCode: 0 };

  if (args[0] === "init") {
    if (
      positionals.length !== 1 ||
      Object.keys(values).some((option) => option !== "config")
    )
      throw new Error("Usage: jevlint init [--config <path>]");

    const filePath = await initializeConfiguration({
      cwd,
      configPath: values.config,
    });

    return {
      stdout: `Created ${filePath} with the magic-strings plugin.\n`,
      stderr: "",
      exitCode: 0,
    };
  }

  const { configuration, directory } = await loadConfiguration({
    cwd,
    configPath: values.config,
    overrides: optionsSchema.parse(values),
  });
  output.format = configuration.format;
  if (!configuration.prettyPrint) {
    output.stdoutColor = false;
    output.stderrColor = false;
  }

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
    projectRoot: cwd,
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
    cache: values["no-cache"] !== true,
    plugins,
    directory,
    timeoutMs: configuration.timeoutMs,
    maxFileBytes: configuration.maxFileBytes,
    writeProgress:
      output.format === "text" && !dryRun && stderrIsTTY && writeProgress
        ? ({ text }) =>
            writeProgress({
              text: styleOutput(text, "muted", output.stderrColor),
            })
        : undefined,
  });

  const result = report({
    results,
    ...configuration,
    pluginIds: plugins.map((plugin) => plugin.id),
    color: output.stdoutColor,
  });

  if (result.stderr)
    result.stderr = styleOutput(result.stderr, "error", output.stderrColor);

  if (dryRun)
    result.stdout = `${JSON.stringify({ requests, results }, null, 2)}\n`;

  return result;
}

export async function runCli(input: CliInput) {
  const formatArguments = input.args.slice(
    0,
    input.args.indexOf("--") < 0 ? input.args.length : input.args.indexOf("--"),
  );
  const requestedFormat = formatArguments
    .flatMap((argument, index) =>
      argument === "--format"
        ? [formatArguments[index + 1]]
        : argument.startsWith("--format=")
          ? [argument.slice("--format=".length)]
          : [],
    )
    .at(-1);
  const output: OutputSettings = {
    format: requestedFormat === "json" ? "json" : "text",
    stdoutColor: false,
    stderrColor: false,
  };
  try {
    return await execute(input, output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (output.format === "json")
      return {
        stdout: `${JSON.stringify({ error: { message } }, null, 2)}\n`,
        stderr: "",
        exitCode: 2,
      };
    return {
      stdout: "",
      stderr: `${styleOutput(`jevlint: ${message}`, "error", output.stderrColor)}\n`,
      exitCode: 2,
    };
  }
}
