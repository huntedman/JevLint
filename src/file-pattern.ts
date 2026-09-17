import { matchesGlob, relative, resolve, sep } from "node:path";

interface FilePatternInput {
  directory: string;
  filePath: string;
  pattern: string;
}

export function matchesFilePattern({
  directory,
  filePath,
  pattern,
}: FilePatternInput) {
  const localPath = relative(directory, filePath).split(sep).join("/");
  const absolutePath = resolve(filePath).split(sep).join("/");

  return (
    matchesGlob(localPath, pattern) ||
    (pattern.startsWith("**/") && matchesGlob(absolutePath, pattern))
  );
}
