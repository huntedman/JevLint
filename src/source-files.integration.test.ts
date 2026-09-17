import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runCli } from "#jevlint/cli.ts";
import { temporaryProject } from "#jevlint/testing/temporary-project.ts";

it.each(["node_modules", "bower_components", "vendor", ".yarn", ".pnpm"])(
  "excludes %s through recursive, glob, and explicit targets",
  async (directory) => {
    const cwd = await temporaryProject({
      files: {
        "src/app.ts": "export const app = 1;",
        [`${directory}/dependency/index.ts`]: "export const external = 1;",
        [`src/${directory}/dependency/index.ts`]: "export const nested = 1;",
      },
    });
    const result = await runCli({
      cwd,
      environment: {},
      args: [
        ".",
        "**/*.ts",
        directory,
        `${directory}/dependency/index.ts`,
        "--dry-run",
      ],
    });
    expect(result.exitCode).toBe(0);
    expect(
      JSON.parse(result.stdout).requests.map(
        (request: { state: { filePath: string } }) => request.state.filePath,
      ),
    ).toEqual(["src/app.ts"]);
  },
);

it("excludes sibling files and external symlink ancestors from CLI and configured targets", async () => {
  const root = await temporaryProject({
    files: {
      "project/src/app.ts": "export const app = 1;",
      "project/config/jevlint.json": JSON.stringify({
        files: ["../src", "../../outside", "../linked/external.ts"],
      }),
      "outside/external.ts": "export const external = 1;",
    },
  });
  const cwd = join(root, "project");
  await symlink(join(root, "outside"), join(cwd, "linked"));

  for (const targets of [
    [],
    [
      "src",
      "../outside",
      join(root, "outside/external.ts"),
      "linked/external.ts",
      "linked/*.ts",
    ],
  ]) {
    const result = await runCli({
      cwd,
      environment: {},
      args: ["--config", "config/jevlint.json", ...targets, "--dry-run"],
    });
    expect(result.exitCode).toBe(0);
    expect(
      JSON.parse(result.stdout).requests.map(
        (request: { state: { filePath: string } }) => request.state.filePath,
      ),
    ).toEqual(["src/app.ts"]);
  }
});

it("excludes aliases pointing into dependency directories", async () => {
  const cwd = await temporaryProject({
    files: {
      "src/app.ts": "export const app = 1;",
      "node_modules/dependency/index.ts": "export const external = 1;",
    },
  });
  await symlink(join(cwd, "node_modules/dependency"), join(cwd, "linked"));
  const result = await runCli({
    cwd,
    environment: {},
    args: ["src", "linked/index.ts", "--dry-run"],
  });
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).requests).toHaveLength(1);
});
