import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readSync } from "node:fs";

const ROOT = process.cwd();
const ENV_FILES = [".env", ".env.local", ".env.example", ".env.local.example"];
const DEFAULT_ENVS = ["production", "preview", "development"];
const SECRET_KEY_PATTERN = /(^|_)(TOKEN|SECRET|KEY|PASSWORD)($|_)/i;

function parseArgs(argv) {
  const args = {
    dryRun: argv.includes("--dry-run"),
    allSecrets: argv.includes("--all-secrets"),
    execute: argv.includes("--execute"),
    vars: [],
    envs: DEFAULT_ENVS,
    project: "",
    scope: ""
  };

  for (const part of argv) {
    if (part.startsWith("--vars=")) args.vars = part.slice("--vars=".length).split(",").map((v) => v.trim()).filter(Boolean);
    if (part.startsWith("--envs=")) args.envs = part.slice("--envs=".length).split(",").map((v) => v.trim()).filter(Boolean);
    if (part.startsWith("--project=")) args.project = part.slice("--project=".length).trim();
    if (part.startsWith("--scope=")) args.scope = part.slice("--scope=".length).trim();
  }

  return args;
}

function parseEnvFile(contents) {
  const output = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const assignment = line.startsWith("export ") ? line.slice(7).trim() : line;
    const equalsIndex = assignment.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = assignment.slice(0, equalsIndex).trim();
    const value = assignment.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) output[key] = value;
  }
  return output;
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  return parseEnvFile(readFileSync(filePath, "utf8"));
}

function readCurrentEnv() {
  return {
    ...loadEnvFile(resolve(ROOT, ".env")),
    ...loadEnvFile(resolve(ROOT, ".env.local")),
    ...process.env
  };
}

function token() {
  return randomBytes(32).toString("hex");
}

function mask(value) {
  const text = String(value || "").trim();
  if (!text) return "unset";
  if (text.length <= 12) return text;
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

function isSecretKey(key) {
  return SECRET_KEY_PATTERN.test(key) || key === "DS_MCP_GITHUB_WEBHOOK_SECRET" || key === "DS_MCP_REST_API_BEARER_TOKEN" || key === "DS_MCP_MCP_BEARER_TOKEN" || key === "DS_MCP_MCP_URL_SECRET" || key === "DS_MCP_INTERNAL_AGENT_RESULT_TOKEN" || key === "DS_MCP_SUPABASE_SERVICE_ROLE_KEY" || key.endsWith("_SERVICE_ROLE_KEY");
}

function managedKeys(current) {
  return uniq([
    ...Object.keys(current)
      .filter((key) => key.startsWith("DS_MCP_"))
      .filter((key) => isSecretKey(key)),
    ...Object.keys(loadEnvFile(resolve(ROOT, ".env.example"))),
    ...Object.keys(loadEnvFile(resolve(ROOT, ".env.local.example")))
  ])
    .filter((key) => key.startsWith("DS_MCP_"))
    .filter((key) => isSecretKey(key))
    .sort();
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const current = readCurrentEnv();
  const discovered = managedKeys(current);
  const keys = args.allSecrets ? discovered : uniq(args.vars);

  if (!keys.length) {
    console.error("No secret vars selected. Use --all-secrets or --vars=KEY1,KEY2");
    process.exit(1);
  }

  const missingProjectContext = !args.project && !existsSync(resolve(ROOT, ".vercel/project.json"));
  if (missingProjectContext) {
    console.error("Missing Vercel project context. Run `vercel link` first or pass --project=<project-name-or-id>.");
    process.exit(1);
  }

  const plan = keys.map((key) => ({
    key,
    old: mask(current[key]),
    next: token()
  }));

  console.log(JSON.stringify({
    ok: true,
    project: args.project || "(linked project)",
    envs: args.envs,
    plan,
    mode: args.dryRun ? "dry-run" : args.execute ? "execute" : "preview"
  }, null, 2));

  if (args.dryRun || !args.execute) {
    return;
  }

  const confirmed = await new Promise((resolveConfirm) => {
    process.stdout.write("Proceed with deleting old secret values and adding new ones? [Y/N] ");
    const buffer = Buffer.alloc(64);
    const bytes = readSync(0, buffer, 0, buffer.length, null);
    const answer = buffer.subarray(0, bytes).toString("utf8").trim().toLowerCase();
    process.stdout.write("\n");
    resolveConfirm(answer === "y" || answer === "yes");
  });

  if (!confirmed) {
    console.log(JSON.stringify({ ok: false, aborted: true }, null, 2));
    return;
  }

  for (const entry of plan) {
    for (const envName of args.envs) {
      const removeArgs = ["env", "rm", entry.key, envName, "--yes"];
      const addArgs = ["env", "add", entry.key, envName];

      if (args.scope) {
        removeArgs.push("--scope", args.scope);
        addArgs.push("--scope", args.scope);
      }

      const remove = spawnSync("vercel", removeArgs, {
        cwd: ROOT,
        stdio: "inherit",
        env: process.env
      });
      if (remove.status !== 0) process.exit(remove.status || 1);

      const add = spawnSync("vercel", addArgs, {
        cwd: ROOT,
        stdio: ["pipe", "inherit", "inherit"],
        env: process.env,
        input: `${entry.next}\n`
      });
      if (add.status !== 0) process.exit(add.status || 1);
    }
  }

  console.log(JSON.stringify({ ok: true, rotated: keys, envs: args.envs }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
