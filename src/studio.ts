import { build } from "esbuild";
import { mkdtemp, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { createStudioServer } from "#jevlint/studio/server.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const assets = await mkdtemp(join(tmpdir(), "jev-studio-"));
const port = Number(process.env.JEV_STUDIO_PORT ?? 4317);

if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("JEV_STUDIO_PORT must be an integer from 1024 to 65535.");

await build({
  entryPoints: [fileURLToPath(import.meta.resolve("#studio/main.ts"))],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  outfile: join(assets, "main.js"),
});

await Promise.all([
  copyFile(join(root, "studio/index.html"), join(assets, "index.html")),
  copyFile(join(root, "studio/style.css"), join(assets, "style.css")),
]);

const server = createStudioServer({
  port,
  assets,
  examplePath: join(root, "examples/graphs/review.jev.json"),
  runDirectory: join(process.cwd(), ".jevlint/runs"),
  apiKey: process.env.JEV_API_KEY ?? "",
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `Jev Studio → http://127.0.0.1:${port}\nRun traces → ${join(process.cwd(), ".jevlint/runs")}\n`,
  );
});

server.on("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  void rm(assets, { recursive: true, force: true });
  process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.closeAllConnections();

    server.close(() => {
      void rm(assets, { recursive: true, force: true });
    });
  });
}
