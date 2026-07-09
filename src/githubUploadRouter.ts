import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { githubUpsertFile } from "./tools/githubClient.js";
import {
  completeUploadSession,
  createUploadSession,
  getCompletedUploadSessionContent,
  getUploadSession,
  markUploadSessionCommitted,
  uploadSessionChunk
} from "./tools/uploadSessionStore.js";
import { writeAuditEvent } from "./tools/auditLog.js";

const createUploadSessionSchema = z.object({
  path: z.string().min(1),
  branch: z.string().min(1),
  message: z.string().min(1),
  size_bytes: z.number().int().min(0),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i)
});

const uploadChunkSchema = z.object({
  content_base64: z.string()
});

type GitHubUploadRouterDeps = {
  config: AppConfig;
  sendJson: (res: ServerResponse, statusCode: number, body: unknown) => void;
  readJsonBody: (req: IncomingMessage) => Promise<unknown>;
};

function repoInput(match: RegExpMatchArray): { owner: string; repo: string } {
  return {
    owner: decodeURIComponent(match[1] ?? ""),
    repo: decodeURIComponent(match[2] ?? "")
  };
}

function assertSessionRepo(
  session: { owner: string; repo: string; session_id: string },
  repo: { owner: string; repo: string }
): void {
  if (session.owner !== repo.owner || session.repo !== repo.repo) {
    throw new Error(`Upload session does not belong to this repository route: ${session.session_id}`);
  }
}

export async function handleGitHubUploadRestApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: GitHubUploadRouterDeps
): Promise<boolean> {
  const collectionMatch = url.pathname.match(
    /^\/api\/github\/repos\/([^/]+)\/([^/]+)\/upload-sessions$/
  );

  if (req.method === "POST" && collectionMatch) {
    const repo = repoInput(collectionMatch);
    const body = createUploadSessionSchema.parse(await deps.readJsonBody(req));
    const session = createUploadSession(deps.config, {
      ...repo,
      path: body.path,
      branch: body.branch,
      message: body.message,
      size_bytes: body.size_bytes,
      sha256: body.sha256
    });

    writeAuditEvent({
      action: "github_create_upload_session",
      source: "rest",
      owner: repo.owner,
      repo: repo.repo,
      branch: session.branch,
      path: session.path,
      status: "success"
    });

    deps.sendJson(res, 201, { ok: true, upload_session: session });
    return true;
  }

  const sessionMatch = url.pathname.match(
    /^\/api\/github\/repos\/([^/]+)\/([^/]+)\/upload-sessions\/([^/]+)$/
  );

  if (req.method === "GET" && sessionMatch) {
    const repo = repoInput(sessionMatch);
    const sessionId = decodeURIComponent(sessionMatch[3] ?? "");
    const session = getUploadSession(deps.config, sessionId);
    assertSessionRepo(session, repo);
    deps.sendJson(res, 200, { ok: true, upload_session: session });
    return true;
  }

  const chunkMatch = url.pathname.match(
    /^\/api\/github\/repos\/([^/]+)\/([^/]+)\/upload-sessions\/([^/]+)\/chunks\/(\d+)$/
  );

  if (req.method === "PUT" && chunkMatch) {
    const repo = repoInput(chunkMatch);
    const body = uploadChunkSchema.parse(await deps.readJsonBody(req));
    const sessionId = decodeURIComponent(chunkMatch[3] ?? "");
    const existingSession = getUploadSession(deps.config, sessionId);
    assertSessionRepo(existingSession, repo);
    const partNumber = Number(chunkMatch[4]);
    const session = uploadSessionChunk(deps.config, {
      session_id: sessionId,
      part_number: partNumber,
      content_base64: body.content_base64
    });

    deps.sendJson(res, 200, { ok: true, upload_session: session });
    return true;
  }

  const completeMatch = url.pathname.match(
    /^\/api\/github\/repos\/([^/]+)\/([^/]+)\/upload-sessions\/([^/]+)\/complete$/
  );

  if (req.method === "POST" && completeMatch) {
    const repo = repoInput(completeMatch);
    const sessionId = decodeURIComponent(completeMatch[3] ?? "");
    const existingSession = getUploadSession(deps.config, sessionId);
    assertSessionRepo(existingSession, repo);
    const session = completeUploadSession(deps.config, sessionId);

    writeAuditEvent({
      action: "github_complete_upload_session",
      source: "rest",
      owner: decodeURIComponent(completeMatch[1] ?? ""),
      repo: decodeURIComponent(completeMatch[2] ?? ""),
      branch: session.branch,
      path: session.path,
      status: "success"
    });

    deps.sendJson(res, 200, { ok: true, upload_session: session });
    return true;
  }

  const commitMatch = url.pathname.match(
    /^\/api\/github\/repos\/([^/]+)\/([^/]+)\/upload-sessions\/([^/]+)\/commit$/
  );

  if (req.method === "POST" && commitMatch) {
    const repo = repoInput(commitMatch);
    const sessionId = decodeURIComponent(commitMatch[3] ?? "");
    const session = getUploadSession(deps.config, sessionId);
    assertSessionRepo(session, repo);
    const content = getCompletedUploadSessionContent(deps.config, sessionId);
    const github = await githubUpsertFile(deps.config, {
      ...repo,
      path: session.path,
      content,
      branch: session.branch,
      message: session.message
    });
    const committedSession = markUploadSessionCommitted(deps.config, sessionId, github.commit_sha);

    writeAuditEvent({
      action: "github_commit_upload_session",
      source: "rest",
      owner: repo.owner,
      repo: repo.repo,
      branch: committedSession.branch,
      path: committedSession.path,
      status: "success",
      message: sessionId
    });

    deps.sendJson(res, 200, { ok: true, upload_session: committedSession, github });
    return true;
  }

  return false;
}
