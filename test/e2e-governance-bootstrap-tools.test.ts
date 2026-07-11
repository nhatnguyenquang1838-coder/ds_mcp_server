import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mcpSource = readFileSync(new URL("../src/mcp.ts", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

function toolBlock(source: string, toolName: string): string {
  const start = source.indexOf(`"${toolName}"`);
  assert.notEqual(start, -1, `${toolName} should be registered`);
  return source.slice(start, start + 2000);
}

test("E2E governance bootstrap exposes tree and binary GitHub reads over MCP", () => {
  assert.match(mcpSource, /githubListTree/);
  assert.match(mcpSource, /githubReadBinaryFile/);

  const treeBlock = toolBlock(mcpSource, "github_list_tree");
  assert.match(treeBlock, /readOnlyHint:\s*true/);

  const binaryBlock = toolBlock(mcpSource, "github_read_binary_file");
  assert.match(binaryBlock, /readOnlyHint:\s*true/);
  assert.match(binaryBlock, /content_base64|base64/);
});

test("E2E governance bootstrap exposes REST tree and binary-file reads", () => {
  assert.match(serverSource, /repoRoute\(url,\s*"tree"\)/);
  assert.match(serverSource, /githubListTree\(config/);
  assert.match(serverSource, /repoRoute\(url,\s*"binary-file"\)/);
  assert.match(serverSource, /githubReadBinaryFile\(config/);
  assert.match(serverSource, /"\/api\/github\/repos\/\{owner\}\/\{repo\}\/tree"/);
  assert.match(serverSource, /"\/api\/github\/repos\/\{owner\}\/\{repo\}\/binary-file"/);
});

test("README documents governance bootstrap read surfaces", () => {
  assert.match(readme, /github_list_tree/);
  assert.match(readme, /github_read_binary_file/);
  assert.match(readme, /\/api\/github\/repos\/\{owner\}\/\{repo\}\/tree/);
  assert.match(readme, /\/api\/github\/repos\/\{owner\}\/\{repo\}\/binary-file/);
  assert.match(readme, /\.governance\/\*\*/);
});
