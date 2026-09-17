import { afterEach, expect, it, vi } from "vitest";
import { runCli } from "#jevlint/cli.ts";
import { temporaryProject } from "#jevlint/testing/temporary-project.ts";

afterEach(() => vi.unstubAllGlobals());

it("returns JSON for argument parsing failures when requested", async () => {
  const cwd = await temporaryProject({ files: {} });
  const result = await runCli({
    cwd,
    args: ["--format=json", "--unknown"],
    environment: {},
  });
  expect(result.exitCode).toBe(2);
  expect(JSON.parse(result.stdout).error.message).toContain("unknown");
  expect(result.stderr).toBe("");
});

async function project(configuration = {}) {
  const cwd = await temporaryProject({
    files: {
      "a.ts": 'const status = "pending";',
      "jevlint.config.json": JSON.stringify(configuration),
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () =>
      Response.json({
        answers: { "magic-strings": { type: "noul", noul: 0.95 } },
      }),
    ),
  );
  return cwd;
}

it.each([
  { tty: true, args: [], environment: {}, colored: true },
  { tty: false, args: [], environment: {}, colored: false },
  { tty: true, args: [], environment: { NO_COLOR: "1" }, colored: false },
  { tty: true, args: [], environment: { TERM: "dumb" }, colored: false },
  { tty: true, args: [], environment: { FORCE_COLOR: "0" }, colored: false },
  { tty: false, args: [], environment: { FORCE_COLOR: "1" }, colored: true },
  {
    tty: false,
    args: ["--color", "always"],
    environment: { NO_COLOR: "1" },
    colored: true,
  },
  {
    tty: true,
    args: ["--color", "never"],
    environment: { FORCE_COLOR: "1" },
    colored: false,
  },
])(
  "selects terminal colours correctly: %j",
  async ({ tty, args, environment, colored }) => {
    const cwd = await project();
    const result = await runCli({
      cwd,
      args,
      environment: { JEV_API_KEY: "test-key", ...environment },
      stdoutIsTTY: tty,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout.includes("\u001b[")).toBe(colored);
    expect(result.stdout).toContain("95.0%");
    expect(result.stdout).toContain("1 file | 1 flagged | 0 failed");
  },
);

it("uses compact plain output when prettyPrint is disabled in config", async () => {
  const cwd = await project({ prettyPrint: false });
  const result = await runCli({
    cwd,
    args: ["--color", "always"],
    environment: { JEV_API_KEY: "test-key" },
    stdoutIsTTY: true,
  });
  expect(result.stdout).toContain("a.ts: warning [magic-strings]");
  expect(result.stdout).toContain("probability 0.950");
  expect(result.stdout).not.toContain("\u001b[");
});

it.each([true, false])(
  "keeps JSON clean with prettyPrint=%s and forced colours",
  async (prettyPrint) => {
    const cwd = await project({ prettyPrint, format: "json" });
    const writeProgress = vi.fn();
    const result = await runCli({
      cwd,
      args: ["--color", "always"],
      environment: { JEV_API_KEY: "test-key" },
      stdoutIsTTY: true,
      stderrIsTTY: true,
      writeProgress,
    });
    expect(JSON.parse(result.stdout).summary.flagged).toBe(1);
    expect(result.stdout).not.toContain("\u001b[");
    expect(result.stderr).toBe("");
    expect(writeProgress).not.toHaveBeenCalled();
  },
);

it.each([{}, { format: "json" }])(
  "returns structured fatal errors when JSON is selected: %j",
  async (configuration) => {
    const cwd = await project(configuration);
    const args = "format" in configuration ? [] : ["--format", "json"];
    const result = await runCli({ cwd, args, environment: {} });
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout).error.message).toContain("JEV_API_KEY");
    expect(result.stderr).toBe("");
  },
);

it("keeps dry-run requests free of colours and progress", async () => {
  const cwd = await project();
  const writeProgress = vi.fn();
  const result = await runCli({
    cwd,
    args: ["--dry-run", "--color", "always"],
    environment: {},
    stdoutIsTTY: true,
    stderrIsTTY: true,
    writeProgress,
  });
  expect(JSON.parse(result.stdout).requests).toHaveLength(1);
  expect(result.stdout).not.toContain("\u001b[");
  expect(writeProgress).not.toHaveBeenCalled();
});

it("uses stderr's terminal capabilities independently of stdout", async () => {
  const cwd = await project();
  const writeProgress = vi.fn();
  const result = await runCli({
    cwd,
    args: [],
    environment: { JEV_API_KEY: "test-key" },
    stdoutIsTTY: false,
    stderrIsTTY: true,
    writeProgress,
  });
  expect(result.stdout).not.toContain("\u001b[");
  expect(writeProgress).toHaveBeenCalledWith({
    text: expect.stringContaining("\u001b["),
  });
});
