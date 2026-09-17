import { glob, lstat, open } from "node:fs/promises";
import { resolve } from "node:path";
import { matchesFilePattern } from "#jevlint/file-pattern.ts";

interface DiscoverFilesInput {
  cwd: string;
  targets: readonly string[];
  ignore: readonly string[];
}

interface ReadSourceInput {
  filePath: string;
  maxFileBytes: number;
}

interface DiscoverTargetInput {
  cwd: string;
  target: string;
  exclude: string[];
}

interface SourceSelectionInput {
  cwd: string;
  filePath: string;
  exclude: readonly string[];
}

interface DiscoverPatternInput {
  cwd: string;
  root: string;
  pattern: string;
  exclude: string[];
}

const ignoredDirectories = [
  "node_modules",
  "dist",
  "release",
  ".git",
  ".next",
  ".turbo",
  ".pnpm-store",
  ".semlint",
  ".jevlint",
  "coverage",
  "secrets",
  "credentials",
];

const sourcePattern = "**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}";

const defaultExclusions = [
  ...ignoredDirectories.map((directory) => `**/${directory}/**`),
  "**/{secrets,credentials}.{js,mjs,cjs,ts}",
];

export async function discoverFiles({
  cwd,
  targets,
  ignore,
}: DiscoverFilesInput) {
  const files = new Set<string>();

  const exclude = [...defaultExclusions, ...ignore];

  for (const target of targets) {
    for await (const filePath of discoverTarget({ cwd, target, exclude })) {
      files.add(filePath);
    }
  }

  if (files.size === 0)
    throw new Error("No JavaScript or TypeScript files found.");

  return [...files].sort();
}

async function* discoverTarget({ cwd, target, exclude }: DiscoverTargetInput) {
  const absolutePath = resolve(cwd, target);

  const metadata = await lstat(absolutePath).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;

    throw error;
  });

  if (metadata?.isFile()) {
    if (isIncludedSource({ cwd, filePath: absolutePath, exclude }))
      yield absolutePath;

    return;
  }

  if (metadata && !metadata.isDirectory()) return;

  yield* discoverPattern({
    cwd,
    root: metadata ? absolutePath : cwd,
    pattern: metadata ? sourcePattern : target,
    exclude,
  });
}

async function* discoverPattern({
  cwd,
  root,
  pattern,
  exclude,
}: DiscoverPatternInput) {
  for await (const entry of glob(pattern, {
    cwd: root,
    exclude: defaultExclusions,
    withFileTypes: true,
  })) {
    const filePath = resolve(entry.parentPath, entry.name);

    if (entry.isFile() && isIncludedSource({ cwd, filePath, exclude }))
      yield filePath;
  }
}

function isIncludedSource({ cwd, filePath, exclude }: SourceSelectionInput) {
  return (
    /\.[cm]?[jt]sx?$/.test(filePath) &&
    !exclude.some((pattern) =>
      matchesFilePattern({ directory: cwd, filePath, pattern }),
    )
  );
}

export async function readSource({ filePath, maxFileBytes }: ReadSourceInput) {
  const file = await open(filePath, "r");

  try {
    if ((await file.stat()).size > maxFileBytes)
      throw new Error(`File exceeds the ${maxFileBytes} byte limit.`);

    const bytes = await file.readFile();

    if (bytes.length > maxFileBytes || bytes.includes(0))
      throw new Error("File is too large or contains binary data.");

    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    await file.close();
  }
}
