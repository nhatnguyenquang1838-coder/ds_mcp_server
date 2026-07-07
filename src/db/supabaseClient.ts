import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppConfig } from "../config.js";

let cachedClient: SupabaseClient | undefined;
let cachedKey: string | undefined;

export function isSupabaseConfigured(config: AppConfig): boolean {
  return Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
}

export function getSupabaseClient(config: AppConfig): SupabaseClient {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error("Supabase is not configured");
  }

  const cacheKey = `${config.supabaseUrl}:${config.supabaseServiceRoleKey.slice(0, 8)}`;
  if (!cachedClient || cachedKey !== cacheKey) {
    cachedClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    cachedKey = cacheKey;
  }

  return cachedClient;
}
