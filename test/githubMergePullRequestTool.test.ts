import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mcpSource = readFileSync(new URL("../src/mcp.ts", import.meta.url), "utf8");

test("GitHub merge PR MCP tool is exposed as a write action", () => {
  const start = mcpSource.indexOf('"github_merge_pr"');
  assert.notEqual(start, -1, "github_merge_pr should be registered");

  const block = mcpSource.slice(start, start + 2500);
  assert.match(block, /githubMergePullRequest/);
  assert.match(block, /readOnlyHint:\s*false/);
  assert.match(block, /pr_number/);
  assert.match(block, /merge_method/);
  assert.match(block, /github_merge_pr/);
});
