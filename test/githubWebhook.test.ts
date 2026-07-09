import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeGithubCiWebhook,
  parseGithubWebhookBody,
  verifyGithubWebhookSignature
} from "../src/agentops/githubWebhook.js";

test("normalizes completed workflow_run success events", () => {
  const result = normalizeGithubCiWebhook({
    eventName: "workflow_run",
    deliveryId: "delivery-1",
    payload: {
      action: "completed",
      repository: { full_name: "owner/repo" },
      workflow_run: {
        conclusion: "success",
        head_sha: "abc123",
        pull_requests: [{ number: 101 }]
      }
    }
  });

  assert.equal(result.ignored, false);
  if (!result.ignored) {
    assert.deepEqual(result.event, {
      delivery_id: "delivery-1",
      repo: "owner/repo",
      pr_number: 101,
      head_sha: "abc123",
      conclusion: "success"
    });
  }
});

test("normalizes cancelled workflow_run as failure", () => {
  const result = normalizeGithubCiWebhook({
    eventName: "workflow_run",
    deliveryId: "delivery-2",
    payload: {
      action: "completed",
      repository: { full_name: "owner/repo" },
      workflow_run: {
        conclusion: "cancelled",
        head_sha: "abc123",
        pull_requests: [{ number: 101 }]
      }
    }
  });

  assert.equal(result.ignored, false);
  if (!result.ignored) {
    assert.equal(result.event.conclusion, "failure");
  }
});

test("ignores non-final workflow_run events", () => {
  const result = normalizeGithubCiWebhook({
    eventName: "workflow_run",
    deliveryId: "delivery-3",
    payload: {
      action: "in_progress",
      repository: { full_name: "owner/repo" },
      workflow_run: { status: "in_progress", head_sha: "abc123" }
    }
  });

  assert.deepEqual(result, { ignored: true, reason: "workflow_run_in_progress" });
});

test("normalizes legacy manual ci_status payloads", () => {
  const result = normalizeGithubCiWebhook({
    eventName: "ci_status",
    payload: {
      delivery_id: "manual-1",
      repo: "owner/repo",
      pr_number: 101,
      head_sha: "abc123",
      conclusion: "failure"
    }
  });

  assert.equal(result.ignored, false);
  if (!result.ignored) {
    assert.equal(result.event.delivery_id, "manual-1");
    assert.equal(result.event.conclusion, "failure");
  }
});

test("verifies GitHub webhook sha256 signatures", () => {
  const secret = "top-secret";
  const rawBody = Buffer.from(JSON.stringify({ ok: true }));
  const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;

  assert.equal(verifyGithubWebhookSignature(secret, rawBody, signature), true);
  assert.equal(verifyGithubWebhookSignature(secret, rawBody, "sha256=bad"), false);
});

test("parses GitHub webhook JSON object body", () => {
  assert.deepEqual(parseGithubWebhookBody(Buffer.from('{"ok":true}')), { ok: true });
  assert.deepEqual(parseGithubWebhookBody(Buffer.from("")), {});
  assert.throws(() => parseGithubWebhookBody(Buffer.from("[]")), /must be a JSON object/);
});
