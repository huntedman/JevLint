import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isLocalRequest, sendJson } from "#jevlint/studio/http.ts";
import { streamRun } from "#jevlint/studio/run-session.ts";
import type { IncomingMessage, ServerResponse } from "node:http";

interface StudioServerInput {
  port: number;
  assets: string;
  examplePath: string;
  runDirectory: string;
  apiKey: string;
}

interface RouteInput {
  request: IncomingMessage;
  response: ServerResponse;
}

interface AssetInput extends RouteInput {
  directory: string;
}

const assets: Partial<Record<string, string>> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/main.js": "main.js",
  "/style.css": "style.css",
};

const contentTypes: Record<string, string> = {
  "index.html": "text/html",
  "main.js": "text/javascript",
  "style.css": "text/css",
};

async function serveAsset({ request, response, directory }: AssetInput) {
  const asset = assets[request.url ?? ""];

  if (!asset || request.method !== "GET")
    return sendJson({ response, status: 404, value: { error: "Not found." } });

  const body = await readFile(join(directory, asset));

  response.writeHead(200, {
    "Content-Type": contentTypes[asset],
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
  });

  response.end(body);
}

class StudioRouter {
  private running = false;
  private readonly config: StudioServerInput;

  constructor(config: StudioServerInput) {
    this.config = config;
  }

  private async run({ request, response }: RouteInput) {
    if (this.running)
      return sendJson({
        response,
        status: 409,
        value: { error: "A run is already active. Stop it first." },
      });

    this.running = true;

    try {
      await streamRun({
        request,
        response,
        apiKey: this.config.apiKey,
        runDirectory: this.config.runDirectory,
      });
    } finally {
      this.running = false;
    }
  }

  async route({ request, response }: RouteInput) {
    if (!isLocalRequest({ request, port: this.config.port }))
      return sendJson({
        response,
        status: 403,
        value: { error: "Local requests only." },
      });

    if (request.url === "/api/status" && request.method === "GET")
      return sendJson({
        response,
        status: 200,
        value: { liveReady: Boolean(this.config.apiKey) },
      });

    if (request.url === "/api/example" && request.method === "GET")
      return sendJson({
        response,
        status: 200,
        value: JSON.parse(await readFile(this.config.examplePath, "utf8")),
      });

    if (request.url === "/api/run" && request.method === "POST")
      return this.run({ request, response });

    return serveAsset({ request, response, directory: this.config.assets });
  }
}

export function createStudioServer(config: StudioServerInput) {
  const router = new StudioRouter(config);

  return createServer((request, response) => {
    void router.route({ request, response }).catch((error: unknown) => {
      if (response.headersSent) {
        response.end();

        return;
      }

      sendJson({
        response,
        status: 400,
        value: {
          error: error instanceof Error ? error.message : "Request failed.",
        },
      });
    });
  });
}
