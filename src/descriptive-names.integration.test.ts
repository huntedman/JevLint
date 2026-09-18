import { afterEach, expect, it, vi } from "vitest";
import { runCli } from "#jevlint/cli.ts";
import { temporaryProject } from "#jevlint/testing/temporary-project.ts";

afterEach(() => vi.unstubAllGlobals());

it("loads descriptive-names by its built-in name with file scopes", async () => {
  const cwd = await temporaryProject({
    files: {
      "jevlint.config.json": JSON.stringify({
        plugins: [
          {
            path: "descriptive-names",
            files: ["src/**"],
            ignore: ["**/*.test.ts"],
          },
        ],
      }),
      "src/invoices.ts":
        "export function doStuff(data) { return data.map(x => x.invoiceId); }",
      "src/invoices.test.ts": "export const fixture = 1;",
      "other.ts": "export const value = 1;",
    },
  });
  const result = await runCli({ cwd, environment: {}, args: ["--dry-run"] });
  expect(result.exitCode).toBe(0);
  const data = JSON.parse(result.stdout);
  expect(data.requests).toHaveLength(1);
  expect(data.requests[0].state.filePath).toBe("src/invoices.ts");
  expect(Object.keys(data.requests[0].questions)).toEqual([
    "descriptive-names",
  ]);
  expect(data.requests[0].questions["descriptive-names"].type).toBe("noul");
  expect(data.results).toHaveLength(2);
});

it("batches both built-in rules and reports a naming-only finding", async () => {
  const cwd = await temporaryProject({
    files: {
      "jevlint.config.json": JSON.stringify({
        plugins: ["magic-strings", "descriptive-names"],
        format: "json",
      }),
      "invoices.ts":
        "export function doStuff(data) { return data.map(x => x.invoiceId); }",
    },
  });
  const fetchMock = vi.fn().mockResolvedValue(
    Response.json({
      answers: {
        "magic-strings": { type: "noul", noul: 0.05 },
        "descriptive-names": { type: "noul", noul: 0.95 },
      },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const result = await runCli({
    cwd,
    environment: { JEV_API_KEY: "test-key" },
    args: [],
  });
  expect(result.exitCode).toBe(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(
    Object.keys(JSON.parse(fetchMock.mock.calls[0][1].body).questions),
  ).toEqual(["magic-strings", "descriptive-names"]);
  const data = JSON.parse(result.stdout);
  expect(data.summary.flagged).toBe(1);
  expect(data.results[0].judgments).toContainEqual({
    pluginId: "descriptive-names",
    probability: 0.95,
    message: expect.stringContaining("Unclear names"),
  });
});
