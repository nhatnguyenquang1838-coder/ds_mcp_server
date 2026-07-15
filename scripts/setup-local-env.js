import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

function parseEnvFile(contents) {
  const output = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const assignment = line.startsWith("export ") ? line.slice(7).trim() : line;
    const equalsIndex = assignment.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = assignment.slice(0, equalsIndex).trim();
    const value = assignment.slice(equalsIndex + 1).trim();
    if (!key) continue;

    output[key] = value.replace(/^['"]|['"]$/g, "");
  }

  return output;
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  return parseEnvFile(readFileSync(filePath, "utf8"));
}

function pick(...values) {
  return values.find((value) => value !== undefined && value !== "") || "";
}

function pickEnv(existing, name, fallback = "") {
  return pick(
    process.env[`DS_MCP_${name}`],
    process.env[name],
    existing[`DS_MCP_${name}`],
    existing[name],
    fallback
  );
}

function token() {
  return randomBytes(32).toString("hex");
}

function quote(value) {
  if (value === "") return "";
  if (/^[A-Za-z0-9_./:+-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

const cwd = process.cwd();
const existing = {
  ...loadEnvFile(resolve(cwd, ".env")),
  ...loadEnvFile(resolve(cwd, ".env.local"))
};

const supabaseUrl = pick(
  process.env.DS_MCP_SUPABASE_PRODUCTION_URL,
  process.env.DS_MCP_SUPABASE_REAL_URL,
  process.env.DS_MCP_SUPABASE_URL,
  process.env.SUPABASE_PRODUCTION_URL,
  process.env.SUPABASE_REAL_URL,
  process.env.SUPABASE_URL,
  existing.DS_MCP_SUPABASE_PRODUCTION_URL,
  existing.DS_MCP_SUPABASE_REAL_URL,
  existing.DS_MCP_SUPABASE_URL,
  existing.SUPABASE_PRODUCTION_URL,
  existing.SUPABASE_REAL_URL,
  existing.SUPABASE_URL
);

const supabaseServiceRoleKey = pick(
  process.env.DS_MCP_SUPABASE_PRODUCTION_SERVICE_ROLE_KEY,
  process.env.DS_MCP_SUPABASE_REAL_SERVICE_ROLE_KEY,
  process.env.DS_MCP_SUPABASE_SERVICE_ROLE_KEY,
  process.env.SUPABASE_PRODUCTION_SERVICE_ROLE_KEY,
  process.env.SUPABASE_REAL_SERVICE_ROLE_KEY,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  existing.DS_MCP_SUPABASE_PRODUCTION_SERVICE_ROLE_KEY,
  existing.DS_MCP_SUPABASE_REAL_SERVICE_ROLE_KEY,
  existing.DS_MCP_SUPABASE_SERVICE_ROLE_KEY,
  existing.SUPABASE_PRODUCTION_SERVICE_ROLE_KEY,
  existing.SUPABASE_REAL_SERVICE_ROLE_KEY,
  existing.SUPABASE_SERVICE_ROLE_KEY
);

const supabaseAnonKey = pick(
  process.env.DS_MCP_SUPABASE_ANON_KEY,
  process.env.SUPABASE_ANON_KEY,
  existing.DS_MCP_SUPABASE_ANON_KEY,
  existing.SUPABASE_ANON_KEY
);

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("Missing Supabase credentials. Set DS_MCP_SUPABASE_URL and DS_MCP_SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(1);
}

const values = {
  DS_MCP_PORT: pickEnv(existing, "PORT", "8787"),
  DS_MCP_MCP_PATH: pickEnv(existing, "MCP_PATH", "/mcp"),
  DS_MCP_PUBLIC_BASE_URL: pickEnv(existing, "PUBLIC_BASE_URL", "http://localhost:8787"),
  DS_MCP_APP_RUNTIME_MODE: "local",
  DS_MCP_SUPABASE_ACTIVE_DB_TARGET: "production",
  DS_MCP_DEV_TOOLS_ENABLED: "true",
  DS_MCP_DEV_TOOLS_ALLOW_REAL_DB_SWITCH: "true",
  DS_MCP_SECURITY_ENFORCEMENT: "strict",
  DS_MCP_CORS_ALLOWED_ORIGINS: pickEnv(existing, "CORS_ALLOWED_ORIGINS", "http://localhost:8787"),
  DS_MCP_MAX_JSON_BODY_BYTES: pickEnv(existing, "MAX_JSON_BODY_BYTES", "1048576"),
  DS_MCP_RATE_LIMIT_WINDOW_MS: pickEnv(existing, "RATE_LIMIT_WINDOW_MS", "60000"),
  DS_MCP_RATE_LIMIT_MAX_REQUESTS: pickEnv(existing, "RATE_LIMIT_MAX_REQUESTS", "120"),
  DS_MCP_SUPABASE_URL: supabaseUrl,
  DS_MCP_SUPABASE_ANON_KEY: supabaseAnonKey || "<your-anon-key>",
  DS_MCP_SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey,
  DS_MCP_SUPABASE_REAL_URL: supabaseUrl,
  DS_MCP_SUPABASE_REAL_SERVICE_ROLE_KEY: supabaseServiceRoleKey,
  DS_MCP_SUPABASE_PRODUCTION_URL: supabaseUrl,
  DS_MCP_SUPABASE_PRODUCTION_SERVICE_ROLE_KEY: supabaseServiceRoleKey,
  DS_MCP_REST_API_BEARER_TOKEN: pickEnv(existing, "REST_API_BEARER_TOKEN", token()),
  DS_MCP_MCP_BEARER_TOKEN: pickEnv(existing, "MCP_BEARER_TOKEN", token()),
  DS_MCP_MCP_URL_SECRET: pickEnv(existing, "MCP_URL_SECRET", token()),
  DS_MCP_GITHUB_WEBHOOK_SECRET: pickEnv(existing, "GITHUB_WEBHOOK_SECRET", token()),
  DS_MCP_WORKSPACE_AGENT_CALLBACK_TOKEN: pick(
    process.env.DS_MCP_WORKSPACE_AGENT_CALLBACK_TOKEN,
    process.env.WORKSPACE_AGENT_CALLBACK_TOKEN,
    existing.DS_MCP_WORKSPACE_AGENT_CALLBACK_TOKEN,
    existing.WORKSPACE_AGENT_CALLBACK_TOKEN,
    token()
  ),
  DS_MCP_DS_BACKEND_URL: pickEnv(existing, "DS_BACKEND_URL", "http://localhost:3000"),
  DS_MCP_INTERNAL_AGENT_RESULT_TOKEN: pick(
    process.env.DS_MCP_INTERNAL_AGENT_RESULT_TOKEN,
    process.env.INTERNAL_AGENT_RESULT_TOKEN,
    existing.DS_MCP_INTERNAL_AGENT_RESULT_TOKEN,
    existing.INTERNAL_AGENT_RESULT_TOKEN,
    token()
  ),
  DS_MCP_WORKSPACE_AGENT_API_BASE_URL: pickEnv(existing, "WORKSPACE_AGENT_API_BASE_URL", "https://api.chatgpt.com"),
  DS_MCP_GITHUB_TOKEN: pickEnv(existing, "GITHUB_TOKEN")
};

const lines = [
  "# Local development credentials generated by `npm run setup:local`.",
  "# Keep this file untracked. It is loaded automatically by the server in local runs.",
  "",
  ...Object.entries(values).flatMap(([key, value]) => {
    if (!value) {
      if (key === "DS_MCP_GITHUB_TOKEN") {
        return ["# Set GITHUB_TOKEN when you need the GitHub gateway locally."];
      }
      return [];
    }

    return `${key}=${quote(value)}`;
  }),
  ""
];

writeFileSync(resolve(cwd, ".env.local"), `${lines.join("\n")}`);

console.log("Wrote .env.local with local security credentials and Supabase settings.");
console.log("Required runtime tokens were generated locally and not printed.");
if (!values.DS_MCP_GITHUB_TOKEN) {
  console.log("DS_MCP_GITHUB_TOKEN was left unset; add it if you need GitHub tools locally.");
}
