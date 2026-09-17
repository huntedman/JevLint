import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { onTestFinished } from "vitest";

interface ProjectInput {
  files: Record<string, string>;
}

export async function temporaryProject({ files }: ProjectInput) {
  const cwd = await mkdtemp(join(tmpdir(), "jevlint-"));

  onTestFinished(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  for (const [filePath, content] of Object.entries(files)) {
    const target = join(cwd, filePath);

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }

  return cwd;
}
