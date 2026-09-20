import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  readFile,
  readdir,
  rename,
  writeFile,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { lintFiles } from "#jevlint/lint-files.ts";
import { runCli } from "#jevlint/cli.ts";
import { temporaryProject } from "#jevlint/testing/temporary-project.ts";

afterEach(() => vi.unstubAllGlobals());

it("reuses persisted judgments and applies the current threshold", async () => {
  const source = 'export const confidentialSource = "source-sentinel";';
  const cwd = await temporaryProject({ files: { "application.ts": source } });
  const fetchMock = vi.fn().mockImplementation(async () =>
    Response.json({
      answers: { "magic-strings": { type: "noul", noul: 0.85 } },
    }),
  );

  vi.stubGlobal("fetch", fetchMock);

  const input = {
    cwd,
    environment: { JEV_API_KEY: "cache-test-api-key" },
    args: ["--format", "json"],
  };
  const first = await runCli(input);
  const second = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./index.ts", import.meta.url)),
      ...input.args,
      "--threshold",
      "0.9",
    ],
    {
      cwd,
      env: { ...process.env, ...input.environment },
      encoding: "utf8",
      timeout: 5000,
    },
  );

  expect(first.exitCode).toBe(1);
  expect(second.status, second.stderr).toBe(0);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(second.stdout).results).toEqual([
    expect.objectContaining({ filePath: "application.ts", cached: true }),
  ]);

  const cacheDirectory = join(cwd, ".jevlint");
  const entries = await readdir(cacheDirectory);

  expect(entries).toHaveLength(1);

  const cached = await readFile(join(cacheDirectory, entries[0]), "utf8");

  expect(cached).not.toContain("source-sentinel");
  expect(cached).not.toContain("cache-test-api-key");
});

it("reanalyzes changed files without sending unchanged files again", async () => {
  const cwd = await temporaryProject({
    files: {
      "first.ts": "export const first = 1;",
      "second.ts": "export const second = 2;",
    },
  });
  const fetchMock = mockAnalysis();
  const input = {
    cwd,
    environment: testEnvironment,
    args: ["--format", "json"],
  };

  await runCli(input);
  await writeFile(join(cwd, "first.ts"), "export const first = 3;");
  const result = await runCli(input);

  expect(result.exitCode).toBe(1);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(JSON.parse(result.stdout).results).toMatchObject([
    { filePath: "first.ts", judgments: [{ probability: 0.85 }] },
    { filePath: "second.ts", cached: true },
  ]);
});

it("invalidates cached judgments when the file path or model changes", async () => {
  const cwd = await temporaryProject({
    files: { "first.ts": "export const value = 1;" },
  });
  const fetchMock = mockAnalysis();
  const input = {
    cwd,
    environment: testEnvironment,
    args: ["--format", "json"],
  };

  await runCli(input);
  await rename(join(cwd, "first.ts"), join(cwd, "renamed.ts"));
  await runCli(input);
  await runCli({ ...input, args: [...input.args, "--model", "another-model"] });

  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it.each([
  { instructions: "Does the source violate a changed rule?" },
  { message: "A changed finding message." },
  { id: "renamed-rule" },
])(
  "invalidates cached judgments when plugin definitions change: %j",
  async (change) => {
    const cwd = await temporaryProject({
      files: { "application.ts": "export const value = 1;" },
    });
    const fetchMock = mockAnalysis();
    const plugin = {
      id: "custom-rule",
      instructions: "Does the source violate the rule?",
      message: "A finding.",
      files: ["**/*"],
      ignore: [],
    };
    const input = {
      cwd,
      directory: cwd,
      files: [join(cwd, "application.ts")],
      plugins: [plugin],
      model: "test-model",
      apiKey: testEnvironment.JEV_API_KEY,
      dryRun: false,
      timeoutMs: 1000,
      maxFileBytes: 1024,
    };

    await lintFiles(input);
    await lintFiles({ ...input, plugins: [{ ...plugin, ...change }] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  },
);

it("does not cache failed requests", async () => {
  const cwd = await temporaryProject({
    files: { "application.ts": "export const value = 1;" },
  });
  const fetchMock = mockAnalysis();
  const input = {
    cwd,
    environment: testEnvironment,
    args: ["--format", "json"],
  };

  fetchMock.mockRejectedValueOnce(new Error("Temporary API failure."));

  expect((await runCli(input)).exitCode).toBe(2);
  await expect(readdir(join(cwd, ".jevlint"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect((await runCli(input)).exitCode).toBe(1);
  expect((await runCli(input)).exitCode).toBe(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it.each([
  "not JSON",
  JSON.stringify([
    { pluginId: "magic-strings", probability: -1, message: "Invalid." },
  ]),
  JSON.stringify([
    { pluginId: "another-rule", probability: 0.85, message: "Wrong rule." },
  ]),
  "[]",
])("reanalyzes files when cache entries are invalid: %s", async (corrupted) => {
  const cwd = await temporaryProject({
    files: { "application.ts": "export const value = 1;" },
  });
  const fetchMock = mockAnalysis();
  const input = {
    cwd,
    environment: testEnvironment,
    args: ["--format", "json"],
  };

  await runCli(input);

  const directory = join(cwd, ".jevlint");
  const [entry] = await readdir(directory);

  await writeFile(join(directory, entry), corrupted);
  expect((await runCli(input)).exitCode).toBe(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("bypasses cache reads and writes with --no-cache", async () => {
  const cwd = await temporaryProject({
    files: { "application.ts": "export const value = 1;" },
  });
  const fetchMock = mockAnalysis();
  const input = {
    cwd,
    environment: testEnvironment,
    args: ["--format", "json"],
  };
  const uncached = { ...input, args: [...input.args, "--no-cache"] };

  expect((await runCli(uncached)).exitCode).toBe(1);
  await expect(readdir(join(cwd, ".jevlint"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await runCli(input);
  await runCli(uncached);

  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("previews requests without reading or populating the cache", async () => {
  const cwd = await temporaryProject({
    files: { "application.ts": "export const value = 1;" },
  });
  const fetchMock = mockAnalysis();
  const input = {
    cwd,
    environment: testEnvironment,
    args: ["--format", "json"],
  };
  const preview = {
    ...input,
    environment: {},
    args: [...input.args, "--dry-run"],
  };

  expect((await runCli(preview)).exitCode).toBe(0);
  await expect(readdir(join(cwd, ".jevlint"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await runCli(input);

  const result = await runCli(preview);

  expect(JSON.parse(result.stdout).requests).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("stores the cache in the checked repository when config is in a subdirectory", async () => {
  const cwd = await temporaryProject({
    files: {
      "application.ts": "export const value = 1;",
      "config/jevlint.json": JSON.stringify({ files: ["../application.ts"] }),
    },
  });

  mockAnalysis();

  const result = await runCli({
    cwd,
    environment: testEnvironment,
    args: ["--config", "config/jevlint.json"],
  });

  expect(result.exitCode).toBe(1);
  expect(await readdir(join(cwd, ".jevlint"))).toHaveLength(1);
  await expect(readdir(join(cwd, "config/.jevlint"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("continues analysis when the cache location is unavailable", async () => {
  const cwd = await temporaryProject({
    files: {
      "application.ts": "export const value = 1;",
      ".jevlint": "existing file",
    },
  });
  const fetchMock = mockAnalysis();
  const input = {
    cwd,
    environment: testEnvironment,
    args: ["--format", "json"],
  };

  expect((await runCli(input)).exitCode).toBe(1);
  expect((await runCli(input)).exitCode).toBe(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(await readFile(join(cwd, ".jevlint"), "utf8")).toBe("existing file");
});

it("does not read or write through a symlinked cache directory", async () => {
  const cwd = await temporaryProject({
    files: { "application.ts": "export const value = 1;" },
  });
  const external = await temporaryProject({ files: {} });

  await symlink(external, join(cwd, ".jevlint"));

  const fetchMock = mockAnalysis();
  const input = {
    cwd,
    environment: testEnvironment,
    args: ["--format", "json"],
  };

  expect((await runCli(input)).exitCode).toBe(1);
  expect((await runCli(input)).exitCode).toBe(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(await readdir(external)).toEqual([]);
});

const testEnvironment = { JEV_API_KEY: "cache-test-api-key" };

function mockAnalysis() {
  const fetchMock = vi.fn<typeof fetch>(async (_url, options) => {
    const request = JSON.parse(String(options?.body));

    return Response.json({
      answers: Object.fromEntries(
        Object.keys(request.questions).map((pluginId) => [
          pluginId,
          { type: "noul", noul: 0.85 },
        ]),
      ),
    });
  });

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

it("checks current source size limits before reusing cached judgments", async () => {
  const cwd = await temporaryProject({
    files: { "application.ts": "export const value = 1;" },
  });
  const fetchMock = mockAnalysis();
  const input = {
    cwd,
    environment: testEnvironment,
    args: ["--format", "json"],
  };

  await runCli(input);
  await writeFile(
    join(cwd, "jevlint.config.json"),
    JSON.stringify({ maxFileBytes: 1 }),
  );

  const result = await runCli(input);

  expect(result.exitCode).toBe(2);
  expect(JSON.parse(result.stdout).summary.failed).toBe(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
