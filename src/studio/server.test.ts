import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { createStudioServer } from "#jevlint/studio/server.ts";
import { eventSchema } from "#jevlint/graph/trace.ts";
import type { Server } from "node:http";

interface Fixture {
  server: Server;
  directory: string;
  url: string;
  graph: unknown;
}

const fixtures: Fixture[] = [];

async function serverFixture(): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), "jev-studio-test-"));

  const examplePath = fileURLToPath(
    new URL("../../examples/graphs/review.jev.json", import.meta.url),
  );

  const config = {
    port: 0,
    assets: directory,
    examplePath,
    runDirectory: directory,
    apiKey: "",
  };

  const server = createStudioServer(config);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();

  if (!address || typeof address === "string")
    throw new Error("Missing address");

  config.port = address.port;

  const fixture = {
    server,
    directory,
    url: `http://127.0.0.1:${address.port}`,
    graph: JSON.parse(await readFile(examplePath, "utf8")),
  };

  fixtures.push(fixture);

  return fixture;
}

afterEach(async () => {
  for (const { server, directory } of fixtures.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

it("streams a simulation and persists the exact graph snapshot and event sequence", async () => {
  const fixture = await serverFixture();

  const response = await fetch(`${fixture.url}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph: fixture.graph, mode: "demo" }),
  });

  const trace = await response.text();

  const events = trace
    .trim()
    .split("\n")
    .map((line) => eventSchema.parse(JSON.parse(line)));

  expect(response.status).toBe(200);

  expect(events[0]).toMatchObject({
    type: "started",
    mode: "demo",
    graph: fixture.graph,
  });

  expect(events.at(-1)).toMatchObject({ type: "completed", nodeId: "review" });

  const files = await readdir(fixture.directory);

  expect(files).toHaveLength(1);
  expect(await readFile(join(fixture.directory, files[0]), "utf8")).toBe(trace);
});

it("rejects foreign browser origins and live runs without credentials before creating a trace", async () => {
  const fixture = await serverFixture();

  const request = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://untrusted.example",
    },
    body: JSON.stringify({ graph: fixture.graph, mode: "demo" }),
  };

  expect((await fetch(`${fixture.url}/api/run`, request)).status).toBe(403);

  expect(
    (
      await fetch(`${fixture.url}/api/run`, {
        ...request,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graph: fixture.graph, mode: "live" }),
      })
    ).status,
  ).toBe(400);

  expect(await readdir(fixture.directory)).toEqual([]);
});

it("prevents concurrent runs and cancels the pending judgment when the stream is disconnected", async () => {
  const fixture = await serverFixture();
  const controller = new AbortController();

  const request = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph: fixture.graph, mode: "demo" }),
  };

  const first = await fetch(`${fixture.url}/api/run`, {
    ...request,
    signal: controller.signal,
  });

  expect(first.status).toBe(200);
  expect((await fetch(`${fixture.url}/api/run`, request)).status).toBe(409);
  controller.abort();

  await expect
    .poll(async () => {
      const [file] = await readdir(fixture.directory);
      const text = await readFile(join(fixture.directory, file), "utf8");

      return JSON.parse(text.trim().split("\n").at(-1)!).type;
    })
    .toBe("cancelled");
});
