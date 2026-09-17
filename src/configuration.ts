import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

export type PluginRegistration = z.infer<typeof pluginRegistrationSchema>;

type Configuration = z.infer<typeof configurationSchema>;

type ConfigurationOverrides = Partial<
  Pick<Configuration, "model" | "threshold" | "format" | "ignore">
>;

interface ConfigurationInput {
  cwd: string;
  configPath?: string;
  overrides: ConfigurationOverrides;
}

interface ReadConfigurationInput {
  filePath: string;
  required: boolean;
}

const patternsSchema = z.array(z.string().trim().min(1));

const pluginRegistrationSchema = z.union([
  z.string().trim().min(1),
  z.strictObject({
    path: z.string().trim().min(1),
    files: patternsSchema.min(1).default(["**/*"]),
    ignore: patternsSchema.default([]),
  }),
]);

const configurationSchema = z.strictObject({
  files: patternsSchema.min(1).default(["."]),
  ignore: patternsSchema.default([]),
  plugins: z.array(pluginRegistrationSchema).min(1).default(["magic-strings"]),
  model: z.string().trim().min(1).default("jev-latest"),
  threshold: z.number().min(0).max(1).default(0.8),
  format: z.enum(["text", "json"]).default("text"),
  prettyPrint: z.boolean().default(true),
  apiKeyEnv: z.string().trim().min(1).default("JEV_API_KEY"),
  timeoutMs: z.int().positive().max(3_600_000).default(30_000),
  maxFileBytes: z.int().positive().default(131_072),
});

export async function initializeConfiguration({
  cwd,
  configPath,
}: Pick<ConfigurationInput, "cwd" | "configPath">) {
  const filePath = resolve(cwd, configPath ?? "jevlint.config.json");
  const configuration = configurationSchema.parse({
    ignore: ["**/*.test.*", "**/*.d.ts"],
  });

  try {
    await writeFile(filePath, `${JSON.stringify(configuration, null, 2)}\n`, {
      flag: "wx",
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      throw new Error(
        `Configuration already exists at ${filePath}; left unchanged.`,
      );

    throw error;
  }

  return filePath;
}

async function readConfiguration({
  filePath,
  required,
}: ReadConfigurationInput) {
  try {
    const input: unknown = JSON.parse(await readFile(filePath, "utf8"));

    return input;
  } catch (error) {
    if (
      !required &&
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return {};

    throw new Error(
      `Cannot read configuration ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export async function loadConfiguration({
  cwd,
  configPath,
  overrides,
}: ConfigurationInput) {
  const filePath = resolve(cwd, configPath ?? "jevlint.config.json");

  const input = await readConfiguration({
    filePath,
    required: configPath !== undefined,
  });

  const parsed = configurationSchema.safeParse(input);

  if (!parsed.success)
    throw new Error(
      `Invalid Jevlint configuration ${filePath}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );

  return {
    directory: dirname(filePath),
    configuration: configurationSchema.parse({
      ...parsed.data,
      model: overrides.model ?? parsed.data.model,
      threshold: overrides.threshold ?? parsed.data.threshold,
      format: overrides.format ?? parsed.data.format,
      ignore: [...parsed.data.ignore, ...(overrides.ignore ?? [])],
    }),
  };
}
