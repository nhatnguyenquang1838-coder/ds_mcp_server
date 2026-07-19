import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const clientSource = readFileSync(new URL("../src/tools/githubClient.ts", import.meta.url), "utf8");
const mcpSource = readFileSync(new URL("../src/mcp.ts", import.meta.url), "utf8");

test("GitHub mark PR ready client calls the review endpoint", () => {
  assert.match(clientSource, /githubMarkPullRequestReadyForReview/);
  assert.match(clientSource, /ready_for_review/);
  assert.match(clientSource, /method:\s*"POST"/);
  assert.match(clientSource, /ready_for_review:\s*true/);
});

test("GitHub mark PR ready MCP tool is exposed as a write action", () => {
  const start = mcpSource.indexOf('"github_mark_pr_ready_for_review"');
  assert.notEqual(start, -1, "github_mark_pr_ready_for_review should be registered");

  const block = mcpSource.slice(start, start + 2500);
  assert.match(block, /githubMarkPullRequestReadyForReview/);
  assert.match(block, /readOnlyHint:\s*false/);
  assert.match(block, /pr_number/);
  assert.match(block, /G3 pass validation/);
});
