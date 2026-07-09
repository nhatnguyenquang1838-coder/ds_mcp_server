import { createHash, randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";

export type UploadSessionStatus = "open" | "completed" | "committed" | "expired";

export type CreateUploadSessionInput = {
  owner: string;
  repo: string;
  path: string;
  branch: string;
  message: string;
  size_bytes: number;
  sha256: string;
};

export type UploadChunkInput = {
  session_id: string;
  part_number: number;
  content_base64: string;
};

export type UploadSessionPublicView = {
  session_id: string;
  owner: string;
  repo: string;
  path: string;
  branch: string;
  message: string;
  size_bytes: number;
  sha256: string;
  status: UploadSessionStatus;
  created_at: string;
  expires_at: string;
  expected_chunks: number;
  uploaded_parts: number[];
  uploaded_bytes: number;
  completed_at?: string;
  committed_at?: string;
  commit_sha?: string;
};

type UploadSessionRecord = CreateUploadSessionInput & {
  session_id: string;
  status: UploadSessionStatus;
  created_at_ms: number;
  expires_at_ms: number;
  chunks: Map<number, Buffer>;
  completed_at_ms?: number;
  committed_at_ms?: number;
  commit_sha?: string;
};

const uploadSessions = new Map<string, UploadSessionRecord>();

const allowedPathPrefixes = [".kiro/specs/", "docs/", "src/", "tests/", "scripts/"];
const blockedPathPatterns = [
  /^\.env(?:\.|$)/,
  /^\.git(?:\/|$)/,
  /^node_modules(?:\/|$)/,
  /^dist(?:\/|$)/,
  /^build(?:\/|$)/,
  /^coverage(?:\/|$)/,
  /^secrets(?:\/|$)/
];

function assertMemoryStorage(config: AppConfig): void {
  if (config.dsUploadStorage !== "memory") {
    throw new Error(`Unsupported DS_UPLOAD_STORAGE for MVP: ${config.dsUploadStorage}`);
  }
}

function assertSafeUploadPath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) {
    throw new Error(`Unsafe upload path: ${path}`);
  }

  const allowed = allowedPathPrefixes.some((prefix) => path.startsWith(prefix));
  if (!allowed) {
    throw new Error(`Upload path must start with one of: ${allowedPathPrefixes.join(", ")}`);
  }

  const blocked = blockedPathPatterns.some((pattern) => pattern.test(path));
  if (blocked) {
    throw new Error(`Upload path is blocked: ${path}`);
  }
}

function assertSha256(value: string): void {
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error("sha256 must be a 64-character hex digest");
  }
}

function cleanupExpiredSessions(nowMs = Date.now()): void {
  for (const session of uploadSessions.values()) {
    if (session.status === "open" && session.expires_at_ms <= nowMs) {
      session.status = "expired";
    }
  }
}

function expectedChunkCount(config: AppConfig, sizeBytes: number): number {
  if (sizeBytes === 0) return 0;
  return Math.ceil(sizeBytes / config.dsUploadChunkMaxBytes);
}

function uploadedBytes(session: UploadSessionRecord): number {
  let total = 0;
  for (const chunk of session.chunks.values()) {
    total += chunk.byteLength;
  }
  return total;
}

function publicView(config: AppConfig, session: UploadSessionRecord): UploadSessionPublicView {
  const uploaded_parts = [...session.chunks.keys()].sort((a, b) => a - b);
  return {
    session_id: session.session_id,
    owner: session.owner,
    repo: session.repo,
    path: session.path,
    branch: session.branch,
    message: session.message,
    size_bytes: session.size_bytes,
    sha256: session.sha256,
    status: session.status,
    created_at: new Date(session.created_at_ms).toISOString(),
    expires_at: new Date(session.expires_at_ms).toISOString(),
    expected_chunks: expectedChunkCount(config, session.size_bytes),
    uploaded_parts,
    uploaded_bytes: uploadedBytes(session),
    completed_at: session.completed_at_ms ? new Date(session.completed_at_ms).toISOString() : undefined,
    committed_at: session.committed_at_ms ? new Date(session.committed_at_ms).toISOString() : undefined,
    commit_sha: session.commit_sha
  };
}

function getMutableSession(sessionId: string): UploadSessionRecord {
  cleanupExpiredSessions();
  const session = uploadSessions.get(sessionId);
  if (!session) {
    throw new Error(`Upload session not found: ${sessionId}`);
  }
  if (session.status === "expired") {
    throw new Error(`Upload session expired: ${sessionId}`);
  }
  return session;
}

function decodeBase64(value: string): Buffer {
  if (!value && value !== "") {
    throw new Error("content_base64 is required");
  }

  const normalized = value.replace(/\s/g, "");
  if (normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error("content_base64 must be standard base64");
  }

  return Buffer.from(normalized, "base64");
}

function assembleSession(session: UploadSessionRecord): Buffer {
  const chunks = [...session.chunks.entries()].sort(([a], [b]) => a - b).map(([, chunk]) => chunk);
  return Buffer.concat(chunks);
}

function assertComplete(config: AppConfig, session: UploadSessionRecord): Buffer {
  const expected = expectedChunkCount(config, session.size_bytes);

  if (session.chunks.size !== expected) {
    throw new Error(`Upload session is incomplete: expected ${expected} chunks, received ${session.chunks.size}`);
  }

  for (let part = 1; part <= expected; part += 1) {
    if (!session.chunks.has(part)) {
      throw new Error(`Upload session is missing chunk: ${part}`);
    }
  }

  const assembled = assembleSession(session);
  if (assembled.byteLength !== session.size_bytes) {
    throw new Error(
      `Upload session size mismatch: expected ${session.size_bytes} bytes, got ${assembled.byteLength}`
    );
  }

  const digest = createHash("sha256").update(assembled).digest("hex");
  if (digest !== session.sha256.toLowerCase()) {
    throw new Error("Upload session checksum mismatch");
  }

  return assembled;
}

export function createUploadSession(
  config: AppConfig,
  input: CreateUploadSessionInput
): UploadSessionPublicView {
  assertMemoryStorage(config);
  cleanupExpiredSessions();
  assertSafeUploadPath(input.path);
  assertSha256(input.sha256);

  if (!Number.isInteger(input.size_bytes) || input.size_bytes < 0) {
    throw new Error("size_bytes must be a non-negative integer");
  }

  if (input.size_bytes > config.dsUploadMaxFileBytes) {
    throw new Error(
      `Upload file exceeds DS_UPLOAD_MAX_FILE_BYTES: ${input.size_bytes} bytes, limit is ${config.dsUploadMaxFileBytes}`
    );
  }

  const nowMs = Date.now();
  const session: UploadSessionRecord = {
    ...input,
    sha256: input.sha256.toLowerCase(),
    session_id: `upload_${randomUUID()}`,
    status: "open",
    created_at_ms: nowMs,
    expires_at_ms: nowMs + config.dsUploadSessionTtlSeconds * 1000,
    chunks: new Map<number, Buffer>()
  };

  uploadSessions.set(session.session_id, session);
  return publicView(config, session);
}

export function uploadSessionChunk(
  config: AppConfig,
  input: UploadChunkInput
): UploadSessionPublicView {
  assertMemoryStorage(config);

  const session = getMutableSession(input.session_id);
  if (session.status !== "open") {
    throw new Error(`Upload session is not open: ${session.status}`);
  }

  if (!Number.isInteger(input.part_number) || input.part_number <= 0) {
    throw new Error("part_number must be a positive integer");
  }

  const expected = expectedChunkCount(config, session.size_bytes);
  if (expected === 0) {
    throw new Error("Zero-byte upload sessions do not accept chunks");
  }
  if (input.part_number > expected) {
    throw new Error(`part_number exceeds expected chunk count: ${input.part_number} > ${expected}`);
  }

  const chunk = decodeBase64(input.content_base64);
  if (chunk.byteLength === 0) {
    throw new Error("Chunk must not be empty");
  }
  if (chunk.byteLength > config.dsUploadChunkMaxBytes) {
    throw new Error(
      `Chunk exceeds DS_UPLOAD_CHUNK_MAX_BYTES: ${chunk.byteLength} bytes, limit is ${config.dsUploadChunkMaxBytes}`
    );
  }

  const previous = session.chunks.get(input.part_number);
  session.chunks.set(input.part_number, chunk);

  if (uploadedBytes(session) > session.size_bytes) {
    if (previous) session.chunks.set(input.part_number, previous);
    else session.chunks.delete(input.part_number);
    throw new Error(`Uploaded bytes exceed declared size_bytes: ${session.size_bytes}`);
  }

  return publicView(config, session);
}

export function completeUploadSession(config: AppConfig, sessionId: string): UploadSessionPublicView {
  assertMemoryStorage(config);

  const session = getMutableSession(sessionId);
  if (session.status !== "open") {
    throw new Error(`Upload session is not open: ${session.status}`);
  }

  assertComplete(config, session);
  session.status = "completed";
  session.completed_at_ms = Date.now();
  return publicView(config, session);
}

export function getUploadSession(config: AppConfig, sessionId: string): UploadSessionPublicView {
  assertMemoryStorage(config);
  return publicView(config, getMutableSession(sessionId));
}

export function getCompletedUploadSessionContent(config: AppConfig, sessionId: string): string {
  assertMemoryStorage(config);

  const session = getMutableSession(sessionId);
  if (session.status !== "completed") {
    throw new Error(`Upload session must be completed before commit: ${session.status}`);
  }

  const assembled = assertComplete(config, session);
  const content = assembled.toString("utf8");
  if (!Buffer.from(content, "utf8").equals(assembled)) {
    throw new Error("Upload session content is not valid UTF-8");
  }

  return content;
}

export function markUploadSessionCommitted(
  config: AppConfig,
  sessionId: string,
  commitSha?: string
): UploadSessionPublicView {
  assertMemoryStorage(config);

  const session = getMutableSession(sessionId);
  if (session.status !== "completed") {
    throw new Error(`Upload session cannot be marked committed from status: ${session.status}`);
  }

  session.status = "committed";
  session.committed_at_ms = Date.now();
  session.commit_sha = commitSha;
  return publicView(config, session);
}
