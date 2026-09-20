import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runCli } from "#jevlint/cli.ts";
import { temporaryProject } from "#jevlint/testing/temporary-project.ts";

afterEach(() => vi.unstubAllGlobals());

it.each(["mjs", "ts"])(
  "executes configured %s plugins during dry runs without calling the Jev API",
  async (extension) => {
    const cwd = await temporaryProject({
      files: {
        "jevlint.config.json": JSON.stringify({
          files: ["src"],
          plugins: ["./rules"],
        }),
        "src/application.ts": "export const application = true;",
        [`rules/index.${extension}`]: `
import { writeFile } from "node:fs/promises";
await writeFile(new URL("../plugin-loaded.txt", import.meta.url), "loaded");
export const plugin = {
  id: "trusted-plugin",
  instructions: "Does this source contain a debug log?",
  message: "Remove debug logs."
};`,
      },
    });
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const result = await runCli({
      cwd,
      environment: {},
      args: ["--dry-run", "--format", "json"],
    });

    expect(result.exitCode).toBe(0);
    expect(await readFile(join(cwd, "plugin-loaded.txt"), "utf8")).toBe(
      "loaded",
    );
    expect(JSON.parse(result.stdout).requests[0].questions).toHaveProperty(
      "trusted-plugin",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  },
);
