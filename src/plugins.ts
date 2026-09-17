import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { plugin as magicStringsPlugin } from "#jevlint-plugins/magic-strings/index.ts";
import type { PluginRegistration } from "#jevlint/configuration.ts";
import { matchesFilePattern } from "#jevlint/file-pattern.ts";

export type LintPlugin = z.infer<typeof pluginSchema>;
export interface ScopedPlugin extends LintPlugin {
  files: readonly string[];
  ignore: readonly string[];
}

interface LoadPluginsInput {
  directory: string;
  registrations: readonly PluginRegistration[];
}

interface LoadDefinitionInput {
  directory: string;
  path: string;
}

interface SelectPluginsInput {
  directory: string;
  filePath: string;
  plugins: readonly ScopedPlugin[];
}

const pluginSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  instructions: z.union([
    z.string().trim().min(1),
    z.array(z.json()).min(1),
    z.record(z.string(), z.json()),
  ]),
  message: z.string().trim().min(1),
});

async function loadDefinition({ directory, path }: LoadDefinitionInput) {
  if (path === magicStringsPlugin.id) return magicStringsPlugin;

  const pluginPath = resolve(directory, path);
  const metadata = await stat(pluginPath);

  const candidates = metadata.isDirectory()
    ? [resolve(pluginPath, "index.ts"), resolve(pluginPath, "index.mjs")]
    : [pluginPath];

  for (const candidate of candidates) {
    if (!(await stat(candidate).catch(() => undefined))?.isFile()) continue;

    const module: unknown = await import(pathToFileURL(candidate).href);

    return z.object({ plugin: z.unknown() }).parse(module).plugin;
  }

  throw new Error(`No index.ts or index.mjs plugin found in ${pluginPath}.`);
}

export async function loadPlugins({
  directory,
  registrations,
}: LoadPluginsInput) {
  const plugins: ScopedPlugin[] = [];

  for (const registration of registrations) {
    const scope =
      typeof registration === "string"
        ? { path: registration, files: ["**/*"], ignore: [] }
        : registration;

    const definition = await loadDefinition({ directory, path: scope.path });
    const parsed = pluginSchema.safeParse(definition);

    if (!parsed.success)
      throw new Error(
        `Invalid Jevlint plugin ${scope.path}: export plugin with id, instructions, and message.`,
      );

    if (plugins.some((plugin) => plugin.id === parsed.data.id))
      throw new Error(`Duplicate plugin id: ${parsed.data.id}.`);

    plugins.push({ ...parsed.data, files: scope.files, ignore: scope.ignore });
  }

  return plugins;
}

export function selectPlugins({
  directory,
  filePath,
  plugins,
}: SelectPluginsInput) {
  return plugins.filter(
    (plugin) =>
      plugin.files.some((pattern) =>
        matchesFilePattern({ directory, filePath, pattern }),
      ) &&
      !plugin.ignore.some((pattern) =>
        matchesFilePattern({ directory, filePath, pattern }),
      ),
  );
}
