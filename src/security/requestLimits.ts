import type { IncomingMessage } from "node:http";

export class PayloadTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

function contentLength(req: IncomingMessage): number | undefined {
  const value = req.headers["content-length"];
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declaredLength = contentLength(req);
  if (declaredLength !== undefined && declaredLength > maxBytes) {
    throw new PayloadTooLargeError(`Request body exceeds limit of ${maxBytes} bytes`);
  }

  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) {
      throw new PayloadTooLargeError(`Request body exceeds limit of ${maxBytes} bytes`);
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

export async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const rawBody = (await readRawBody(req, maxBytes)).toString("utf8");

  if (!rawBody.trim()) {
    return {};
  }

  return JSON.parse(rawBody) as unknown;
}
