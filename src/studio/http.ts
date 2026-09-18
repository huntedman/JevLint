import type { IncomingMessage, ServerResponse } from "node:http";

interface RequestInput {
  request: IncomingMessage;
}

interface JsonResponseInput {
  response: ServerResponse;
  status: number;
  value: unknown;
}

interface LocalRequestInput extends RequestInput {
  port: number;
}

export async function readJson({ request }: RequestInput): Promise<unknown> {
  let length = 0;
  const chunks: Buffer[] = [];

  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new Error("Expected application/json.");

  for await (const chunk of request) {
    length += chunk.length;

    if (length > 1_000_000) throw new Error("Request exceeds 1 MB.");

    chunks.push(Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function sendJson({ response, status, value }: JsonResponseInput) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });

  response.end(JSON.stringify(value));
}

export function isLocalRequest({ request, port }: LocalRequestInput): boolean {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const origin = request.headers.origin;

  return (
    hosts.includes(request.headers.host ?? "") &&
    (!origin || hosts.some((host) => origin === `http://${host}`))
  );
}
