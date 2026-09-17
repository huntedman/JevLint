import { mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runCli } from "#jevlint/cli.ts";
import { temporaryProject } from "#jevlint/testing/temporary-project.ts";

interface AnswerInput {
  probability: number;
}

const apiKey = "test-jevlint-key";
const environment = { JEV_API_KEY: apiKey };
const source = 'const active = focus === "tabs";';

afterEach(() => {
  vi.unstubAllGlobals();
});

function answer({ probability }: AnswerInput) {
  return Response.json({
    answers: { "magic-strings": { type: "noul", noul: probability } },
  });
}

it("scans nested files once, applies exclusions, and sends a NOUL question for each file", async () => {
  const cwd = await temporaryProject({
    files: {
      "src/a.ts": source,
      "src/nested/b.jsx": "const greeting = 'Hello';",
      "src/node_modules/library/index.js": source,
      "src/dist/built.js": source,
      "src/credentials.ts": source,
      "src/ignored.test.ts": source,
      "src/data.json": "{}",
    },
  });

  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(answer({ probability: 0.95 }))
    .mockResolvedValueOnce(answer({ probability: 0.1 }));

  vi.stubGlobal("fetch", fetchMock);

  const result = await runCli({
    cwd,
    environment,
    args: ["src", "src/a.ts", "--ignore", "**/*.test.ts", "--format", "json"],
  });

  const data = JSON.parse(result.stdout);

  expect(result.exitCode).toBe(1);
  expect(data.summary).toEqual({ files: 2, flagged: 1, failed: 0, skipped: 0 });

  expect(data.results).toMatchObject([
    { filePath: "src/a.ts" },
    { filePath: "src/nested/b.jsx" },
  ]);

  expect(fetchMock).toHaveBeenCalledTimes(2);

  const [url, options] = fetchMock.mock.calls[0];

  expect(url).toBe("https://api.typesafe.ai/v1/systemone");
  expect(options?.headers).toMatchObject({ Authorization: `Bearer ${apiKey}` });

  expect(JSON.parse(String(options?.body))).toMatchObject({
    model: "jev-latest",
    state: { filePath: "src/a.ts", source },
    questions: { "magic-strings": { type: "noul" } },
  });
});

it("previews the ported policy and file contents without credentials or network access", async () => {
  const cwd = await temporaryProject({ files: { "a.ts": source } });
  const fetchMock = vi.fn();

  vi.stubGlobal("fetch", fetchMock);

  const result = await runCli({
    cwd,
    environment: {},
    args: ["--dry-run", "--model", "jev-1.13.0"],
  });

  const data = JSON.parse(result.stdout);
  const request = data.requests[0];

  expect(result.exitCode).toBe(0);
  expect(request).toMatchObject({ model: "jev-1.13.0", state: { source } });
  expect(JSON.stringify(request.questions)).toContain("SQL statements");
  expect(JSON.stringify(request.questions)).toContain("Library-owned values");

  expect(JSON.stringify(request.questions)).toContain(
    "serialized 'true' / 'false'",
  );

  expect(fetchMock).not.toHaveBeenCalled();
});

it("reports file-level warnings at the threshold without inventing locations", async () => {
  const cwd = await temporaryProject({ files: { "example.ts": source } });

  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(answer({ probability: 0.7 })),
  );

  const result = await runCli({
    cwd,
    environment,
    args: ["example.ts", "--threshold", "0.7"],
  });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("example.ts: warning [magic-strings]");
  expect(result.stdout).toContain("probability 0.700");
  expect(result.stdout).toContain("1 files, 1 flagged, 0 failed");
});

it("continues after an API failure and returns the failure exit code", async () => {
  const cwd = await temporaryProject({
    files: { "a.ts": source, "b.ts": source },
  });

  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("Overloaded", { status: 529 }))
    .mockResolvedValueOnce(answer({ probability: 0.99 }));

  vi.stubGlobal("fetch", fetchMock);

  const result = await runCli({ cwd, environment, args: ["--format", "json"] });

  expect(result.exitCode).toBe(2);

  expect(JSON.parse(result.stdout).summary).toEqual({
    files: 2,
    flagged: 1,
    failed: 1,
    skipped: 0,
  });

  expect(result.stderr).toContain("a.ts: Jev API returned HTTP 529");
  expect(result.stderr).not.toContain(apiKey);
});

it.each([
  {},
  { type: "noul", noul: 1.5 },
  { type: "noul", noul: "0.9" },
  { type: "choice", noul: 0.9 },
])("rejects invalid Jev answers: %j", async (invalidAnswer) => {
  const cwd = await temporaryProject({ files: { "a.ts": source } });

  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ answers: { "magic-strings": invalidAnswer } }),
      ),
  );

  const result = await runCli({ cwd, environment, args: [] });

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("invalid magic-strings NOUL answer");
});

it("returns success for a clean file and reports its probability in JSON", async () => {
  const cwd = await temporaryProject({ files: { "a.ts": source } });

  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(answer({ probability: 0.05 })),
  );

  const result = await runCli({ cwd, environment, args: ["--format", "json"] });

  expect(result.exitCode).toBe(0);

  expect(JSON.parse(result.stdout).results[0].judgments[0].probability).toBe(
    0.05,
  );
});

it("rejects missing credentials and invalid thresholds before making requests", async () => {
  const fetchMock = vi.fn();

  vi.stubGlobal("fetch", fetchMock);

  const missingKey = await runCli({ cwd: tmpdir(), environment: {}, args: [] });

  const invalidThreshold = await runCli({
    cwd: tmpdir(),
    environment,
    args: ["--threshold", "1.1"],
  });

  expect(missingKey.exitCode).toBe(2);
  expect(missingKey.stderr).toContain("JEV_API_KEY");
  expect(invalidThreshold.exitCode).toBe(2);
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each(["JEV_API_KEY", "CUSTOM_JEV_KEY"])(
  "loads %s from the working directory's .env with a separate config directory",
  async (apiKeyEnv) => {
    const cwd = await temporaryProject({
      files: {
        ".env": `# Local credentials\n${apiKeyEnv}="${apiKey}"\n`,
        "config/.env": `${apiKeyEnv}=wrong-directory-key`,
        "config/jevlint.json": JSON.stringify({ files: ["../src"], apiKeyEnv }),
        "src/a.ts": source,
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(answer({ probability: 0.1 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runCli({
      cwd,
      environment: {},
      args: ["--config", "config/jevlint.json"],
    });

    expect(result.exitCode).toBe(0);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      `Bearer ${apiKey}`,
    );
  },
);

it.each([apiKey, ""])(
  "preserves an existing environment value over .env: %j",
  async (existingKey) => {
    const cwd = await temporaryProject({
      files: { ".env": "JEV_API_KEY=file-key", "a.ts": source },
    });
    const fetchMock = vi.fn().mockResolvedValue(answer({ probability: 0.1 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runCli({
      cwd,
      environment: { JEV_API_KEY: existingKey },
      args: [],
    });

    if (existingKey) {
      expect(result.exitCode).toBe(0);
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
        `Bearer ${existingKey}`,
      );
    } else {
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("Set JEV_API_KEY");
      expect(fetchMock).not.toHaveBeenCalled();
    }
  },
);

it("reports an unreadable .env as a failure before making requests", async () => {
  const cwd = await temporaryProject({ files: { "a.ts": source } });
  await mkdir(join(cwd, ".env"));
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const result = await runCli({ cwd, environment, args: [] });

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("EISDIR");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("does not read binary, oversized, or symlinked sources", async () => {
  const cwd = await temporaryProject({
    files: { "binary.ts": "\0", "large.ts": "x".repeat(128 * 1024 + 1) },
  });

  const fetchMock = vi.fn();

  await symlink(join(cwd, "binary.ts"), join(cwd, "link.ts"));
  vi.stubGlobal("fetch", fetchMock);

  const result = await runCli({ cwd, environment, args: ["--format", "json"] });

  expect(result.exitCode).toBe(2);

  expect(JSON.parse(result.stdout).summary).toEqual({
    files: 2,
    flagged: 0,
    failed: 2,
    skipped: 0,
  });

  expect(fetchMock).not.toHaveBeenCalled();
});

it("fails clearly when a folder contains no supported files", async () => {
  const cwd = await temporaryProject({ files: { "data.json": "{}" } });
  const result = await runCli({ cwd, environment, args: [] });

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("No JavaScript or TypeScript files found");
});

it("interprets ignore patterns relative to the working directory", async () => {
  const cwd = await temporaryProject({ files: { "src/a.ts": source } });

  const result = await runCli({
    cwd,
    environment: {},
    args: ["src", "--dry-run", "--ignore", "*.ts"],
  });

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).requests).toHaveLength(1);
});

it("accepts literal file paths containing glob characters", async () => {
  const cwd = await temporaryProject({ files: { "src/[id].tsx": source } });

  const result = await runCli({
    cwd,
    environment: {},
    args: ["src/[id].tsx", "--dry-run"],
  });

  expect(result.exitCode).toBe(0);

  expect(JSON.parse(result.stdout).requests[0].state.filePath).toBe(
    "src/[id].tsx",
  );
});
