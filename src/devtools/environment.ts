import type { AppConfig, DatabaseProfile, RuntimeMode } from "../config.js";

export type EnvironmentSwitchInput = {
  runtime_mode?: RuntimeMode;
  db_target?: string;
};

const REAL_DB_TARGETS = new Set(["real", "production", "prod"]);

function configured(profile: DatabaseProfile | undefined): boolean {
  return Boolean(profile?.supabaseUrl && profile.supabaseServiceRoleKey);
}

function urlHost(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).host;
  } catch {
    return "invalid-url";
  }
}

function profileView(target: string, profile: DatabaseProfile | undefined, activeTarget: string) {
  return {
    target,
    active: target === activeTarget,
    configured: configured(profile),
    supabase_host: urlHost(profile?.supabaseUrl),
    service_role_key_configured: Boolean(profile?.supabaseServiceRoleKey),
    real_database_guard_required: REAL_DB_TARGETS.has(target)
  };
}

export function getEnvironmentStatus(config: AppConfig) {
  const profiles = Object.entries(config.databaseProfiles)
    .map(([target, profile]) => profileView(target, profile, config.activeDbTarget))
    .sort((a, b) => a.target.localeCompare(b.target));

  return {
    ok: true,
    runtime_mode: config.runtimeMode,
    active_db_target: config.activeDbTarget,
    database: {
      configured: Boolean(config.supabaseUrl && config.supabaseServiceRoleKey),
      supabase_host: urlHost(config.supabaseUrl),
      profiles
    },
    dev_tools: {
      enabled: config.devToolsEnabled,
      real_db_switch_allowed: config.devToolsAllowRealDbSwitch
    }
  };
}

export function switchRuntimeEnvironment(config: AppConfig, input: EnvironmentSwitchInput) {
  if (!config.devToolsEnabled) {
    throw new Error("Dev tools are not enabled");
  }

  if (!input.runtime_mode && !input.db_target) {
    throw new Error("runtime_mode or db_target is required");
  }

  if (input.runtime_mode) {
    config.runtimeMode = input.runtime_mode;
  }

  if (input.db_target) {
    const target = input.db_target.trim();
    const profile = config.databaseProfiles[target];

    if (!profile) {
      throw new Error(`Database target not configured: ${target}`);
    }

    if (!configured(profile)) {
      throw new Error(`Database target is missing Supabase credentials: ${target}`);
    }

    if (REAL_DB_TARGETS.has(target) && !config.devToolsAllowRealDbSwitch) {
      throw new Error(
        `Switching to ${target} database requires DEV_TOOLS_ALLOW_REAL_DB_SWITCH=true`
      );
    }

    config.activeDbTarget = target;
    config.supabaseUrl = profile.supabaseUrl;
    config.supabaseServiceRoleKey = profile.supabaseServiceRoleKey;
  }

  return getEnvironmentStatus(config);
}
