import { expect, it } from "vitest";
import { runCli } from "#jevlint/cli.ts";
import { temporaryProject } from "#jevlint/testing/temporary-project.ts";

it.each(["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"])(
  "excludes credential filenames with the %s extension from every target mode",
  async (extension) => {
    const sourcePath = `src/application.${extension}`;
    const credentialPaths = [
      `secrets.${extension}`,
      `credentials.${extension}`,
      `src/secrets.${extension}`,
      `src/credentials.${extension}`,
    ];
    const source = "export const application = true;";
    const credentialSource = 'export const key = "credential-test-sentinel";';
    const cwd = await temporaryProject({
      files: {
        [sourcePath]: source,
        ...Object.fromEntries(
          credentialPaths.map((filePath) => [filePath, credentialSource]),
        ),
      },
    });

    for (const targets of [
      ["."],
      [`**/*.${extension}`],
      [sourcePath, ...credentialPaths],
    ]) {
      const result = await runCli({
        cwd,
        environment: {},
        args: [...targets, "--dry-run", "--format", "json"],
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("credential-test-sentinel");
      expect(JSON.parse(result.stdout).requests).toEqual([
        expect.objectContaining({ state: { filePath: sourcePath, source } }),
      ]);
    }
  },
);
