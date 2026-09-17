import { readFile, readdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runCli } from "#jevlint/cli.ts";
import { temporaryProject } from "#jevlint/testing/temporary-project.ts";

afterEach(() => vi.unstubAllGlobals());

it("initializes without credentials and creates a usable magic-strings configuration", async () => {
  const cwd = await temporaryProject({
    files: {
      "src/a.ts": 'const state = "pending";',
      "src/a.test.ts": 'const state = "pending";',
    },
  });
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const result = await runCli({ cwd, args: ["init"], environment: {} });
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Created");
  const config = JSON.parse(
    await readFile(join(cwd, "jevlint.config.json"), "utf8"),
  );
  expect(config.plugins).toEqual(["magic-strings"]);
  expect(config.prettyPrint).toBe(true);

  const preview = await runCli({ cwd, args: ["--dry-run"], environment: {} });
  expect(preview.exitCode).toBe(0);
  const requests = JSON.parse(preview.stdout).requests;
  expect(requests).toHaveLength(1);
  expect(requests[0].questions).toHaveProperty("magic-strings");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("preserves an existing config, even when it is invalid JSON", async () => {
  const original = "keep this content";
  const cwd = await temporaryProject({
    files: { "jevlint.config.json": original },
  });
  const result = await runCli({ cwd, args: ["init"], environment: {} });
  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("already exists");
  expect(await readFile(join(cwd, "jevlint.config.json"), "utf8")).toBe(
    original,
  );
});

it("does not follow an existing config symlink", async () => {
  const cwd = await temporaryProject({ files: { "existing.json": "{}" } });
  await symlink(join(cwd, "existing.json"), join(cwd, "jevlint.config.json"));
  const result = await runCli({ cwd, args: ["init"], environment: {} });
  expect(result.exitCode).toBe(2);
  expect(await readFile(join(cwd, "existing.json"), "utf8")).toBe("{}");
});

it("initializes a custom config path", async () => {
  const cwd = await temporaryProject({ files: {} });
  const result = await runCli({
    cwd,
    args: ["init", "--config", "custom.json"],
    environment: {},
  });
  expect(result.exitCode).toBe(0);
  expect(await readdir(cwd)).toEqual(["custom.json"]);
});

it.each([
  ["init", "--help"],
  ["init", "--dry-run"],
  ["init", "src"],
])(
  "does not write files for help or unsupported init arguments: %j",
  async (...args) => {
    const cwd = await temporaryProject({ files: {} });
    const result = await runCli({ cwd, args, environment: {} });
    expect(result.exitCode).toBe(args.includes("--help") ? 0 : 2);
    expect(await readdir(cwd)).toEqual([]);
  },
);
