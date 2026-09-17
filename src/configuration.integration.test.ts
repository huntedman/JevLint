import { afterEach, expect, it, vi } from "vitest";
import { runCli } from "#jevlint/cli.ts";
import { temporaryProject } from "#jevlint/testing/temporary-project.ts";

const magicStringsId = "magic-strings";
const customRuleId = "custom-rule";
const source = 'const active = state === "ready";';
const environment = { JEV_API_KEY: "test-key" };

const customPlugin = `export const plugin = {
  id: "${customRuleId}",
  instructions: "Does this file contain a debug log?",
  message: "Remove debug logs."
};`;

afterEach(() => {
  vi.unstubAllGlobals();
});

it("loads the default config and combines folders, globs, exclusions, and plugin scopes", async () => {
  const cwd = await temporaryProject({
    files: {
      "jevlint.config.json": JSON.stringify({
        files: ["src/**/*.ts", "other"],
        ignore: ["**/*.test.ts"],
        model: "configured-model",
        plugins: [
          { path: magicStringsId, files: ["src/**"], ignore: ["**/skip.ts"] },
        ],
      }),
      "src/a.ts": source,
      "src/a.test.ts": source,
      "src/skip.ts": source,
      "other/b.js": source,
    },
  });

  const result = await runCli({ cwd, environment: {}, args: ["--dry-run"] });
  const data = JSON.parse(result.stdout);

  expect(result.exitCode).toBe(0);
  expect(data.requests).toHaveLength(1);

  expect(data.requests[0]).toMatchObject({
    model: "configured-model",
    state: { filePath: "src/a.ts" },
  });

  expect(data.results).toEqual([
    { filePath: "other/b.js", status: "skipped" },
    { filePath: "src/skip.ts", status: "skipped" },
  ]);
});

it("resolves configured files and local plugins beside an explicitly selected config", async () => {
  const cwd = await temporaryProject({
    files: {
      "config/jevlint.json": JSON.stringify({
        files: ["src"],
        plugins: ["./rules"],
      }),
      "config/src/a.ts": source,
      "config/rules/index.mjs": customPlugin,
      "src/unused.ts": source,
    },
  });

  const result = await runCli({
    cwd,
    environment: {},
    args: ["--config", "config/jevlint.json", "--dry-run"],
  });

  const requests = JSON.parse(result.stdout).requests;

  expect(result.exitCode).toBe(0);
  expect(requests).toHaveLength(1);
  expect(requests[0].state.filePath).toBe("config/src/a.ts");
  expect(Object.keys(requests[0].questions)).toEqual([customRuleId]);
});

it("lets CLI targets and settings override config while adding ignore patterns", async () => {
  const cwd = await temporaryProject({
    files: {
      "config/jevlint.json": JSON.stringify({
        files: ["missing"],
        model: "configured",
        format: "text",
        threshold: 0.99,
        ignore: ["../src/ignored.ts"],
      }),
      "src/a.ts": source,
      "src/ignored.ts": source,
      "src/b.test.ts": source,
    },
  });

  const fetchMock = vi.fn().mockResolvedValue(
    Response.json({
      answers: { [magicStringsId]: { type: "noul", noul: 0.7 } },
    }),
  );

  vi.stubGlobal("fetch", fetchMock);

  const result = await runCli({
    cwd,
    environment,
    args: [
      "--config",
      "config/jevlint.json",
      "src/**/*.ts",
      "--model",
      "cli-model",
      "--threshold",
      "0.6",
      "--format",
      "json",
      "--ignore",
      "**/*.test.ts",
    ],
  });

  const data = JSON.parse(result.stdout);

  expect(result.exitCode).toBe(1);

  expect(data).toMatchObject({
    model: "cli-model",
    threshold: 0.6,
    summary: { files: 1, flagged: 1 },
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("batches selected plugins in one request and reports each result by plugin id", async () => {
  const cwd = await temporaryProject({
    files: {
      "jevlint.config.json": JSON.stringify({
        files: ["src"],
        plugins: [magicStringsId, "./rules/index.mjs"],
        format: "json",
        threshold: 0.9,
        apiKeyEnv: "CUSTOM_JEV_KEY",
      }),
      "src/a.ts": source,
      "rules/index.mjs": customPlugin,
    },
  });

  const fetchMock = vi.fn().mockResolvedValue(
    Response.json({
      answers: {
        [magicStringsId]: { type: "noul", noul: 0.2 },
        [customRuleId]: { type: "noul", noul: 0.95 },
      },
    }),
  );

  vi.stubGlobal("fetch", fetchMock);

  const result = await runCli({
    cwd,
    environment: { CUSTOM_JEV_KEY: "custom-key" },
    args: [],
  });

  const data = JSON.parse(result.stdout);
  const [, options] = fetchMock.mock.calls[0];

  expect(result.exitCode).toBe(1);
  expect(data.plugins).toEqual([magicStringsId, customRuleId]);

  expect(data.results[0].judgments).toContainEqual({
    pluginId: customRuleId,
    probability: 0.95,
    message: "Remove debug logs.",
  });

  expect(Object.keys(JSON.parse(options.body).questions)).toEqual(data.plugins);
  expect(options.headers.Authorization).toBe("Bearer custom-key");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("does not send files outside every plugin scope", async () => {
  const cwd = await temporaryProject({
    files: {
      "jevlint.config.json": JSON.stringify({
        files: ["src"],
        plugins: [{ path: magicStringsId, files: ["other/**"] }],
        format: "json",
      }),
      "src/a.ts": source,
    },
  });

  const fetchMock = vi.fn();

  vi.stubGlobal("fetch", fetchMock);

  const result = await runCli({ cwd, environment, args: [] });

  expect(result.exitCode).toBe(0);

  expect(JSON.parse(result.stdout).summary).toEqual({
    files: 1,
    flagged: 0,
    failed: 0,
    skipped: 1,
  });

  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
  "{broken",
  "null",
  '{"threshold":2}',
  '{"plugins":[]}',
  '{"typo":true}',
])("rejects invalid config instead of falling back: %s", async (config) => {
  const cwd = await temporaryProject({
    files: { "jevlint.config.json": config, "a.ts": source },
  });

  const result = await runCli({ cwd, environment: {}, args: ["--dry-run"] });

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("configuration");
});

it("requires explicitly selected config files to exist", async () => {
  const cwd = await temporaryProject({ files: { "a.ts": source } });

  const result = await runCli({
    cwd,
    environment: {},
    args: ["--config", "missing.json", "--dry-run"],
  });

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("missing.json");
});

it("rejects duplicate plugins before any requests", async () => {
  const cwd = await temporaryProject({
    files: {
      "jevlint.config.json": JSON.stringify({
        plugins: [magicStringsId, magicStringsId],
      }),
      "a.ts": source,
    },
  });

  const result = await runCli({ cwd, environment: {}, args: ["--dry-run"] });

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("Duplicate plugin id");
});

it("rejects incomplete plugin definitions", async () => {
  const cwd = await temporaryProject({
    files: {
      "jevlint.config.json": JSON.stringify({ plugins: ["./rules"] }),
      "rules/index.mjs": 'export const plugin = { id: "incomplete" };',
      "a.ts": source,
    },
  });

  const result = await runCli({ cwd, environment: {}, args: ["--dry-run"] });

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("Invalid Jevlint plugin");
});

it("honors configured file size limits without sending oversized files", async () => {
  const cwd = await temporaryProject({
    files: {
      "jevlint.config.json": JSON.stringify({
        maxFileBytes: 4,
        files: ["a.ts"],
      }),
      "a.ts": source,
    },
  });

  const result = await runCli({ cwd, environment: {}, args: ["--dry-run"] });

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("4 byte limit");
  expect(JSON.parse(result.stdout).requests).toEqual([]);
});
