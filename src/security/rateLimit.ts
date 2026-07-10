import type { AppConfig } from "../config.js";
import { getSupabaseClient, isSupabaseConfigured } from "../db/supabaseClient.js";

type RateLimitState = {
  windowStartedAt: number;
  requestCount: number;
};

export type RateLimitDecision =
  | { allowed: true; remaining: number; resetAt: string; count: number; backend: "memory" | "supabase" }
  | { allowed: false; retryAfterSeconds: number; limit: number; count: number; backend: "memory" | "supabase" };

const inMemoryBuckets = new Map<string, RateLimitState>();

function nowMs(): number {
  return Date.now();
}

function bucketKey(routeId: string, principalId: string, clientKey: string): string {
  return `${routeId}\u0000${principalId}\u0000${clientKey}`;
}

function memoryAcquire(key: string, windowMs: number, maxRequests: number): RateLimitDecision {
  const current = nowMs();
  const existing = inMemoryBuckets.get(key);
  if (!existing || current - existing.windowStartedAt >= windowMs) {
    inMemoryBuckets.set(key, { windowStartedAt: current, requestCount: 1 });
    return {
      allowed: true,
      remaining: Math.max(maxRequests - 1, 0),
      resetAt: new Date(current + windowMs).toISOString(),
      count: 1,
      backend: "memory"
    };
  }

  existing.requestCount += 1;
  if (existing.requestCount > maxRequests) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.windowStartedAt + windowMs - current) / 1000)),
      limit: maxRequests,
      count: existing.requestCount,
      backend: "memory"
    };
  }

  return {
    allowed: true,
    remaining: Math.max(maxRequests - existing.requestCount, 0),
    resetAt: new Date(existing.windowStartedAt + windowMs).toISOString(),
    count: existing.requestCount,
    backend: "memory"
  };
}

async function supabaseAcquire(
  config: AppConfig,
  key: string,
  windowMs: number,
  maxRequests: number
): Promise<RateLimitDecision> {
  const supabase = getSupabaseClient(config);
  const { data, error } = await supabase.rpc("security_rate_limit_acquire", {
    bucket_key: key,
    window_ms: windowMs,
    max_requests: maxRequests
  });

  if (error) {
    throw new Error(`Security rate limit RPC failed: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  const allowed = Boolean((row as Record<string, unknown> | undefined)?.allowed);
  const count = Number((row as Record<string, unknown> | undefined)?.count ?? 0);
  const resetAt = String((row as Record<string, unknown> | undefined)?.reset_at ?? new Date().toISOString());
  const remaining = Number((row as Record<string, unknown> | undefined)?.remaining ?? Math.max(maxRequests - count, 0));

  if (!allowed) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((new Date(resetAt).getTime() - nowMs()) / 1000)),
      limit: maxRequests,
      count,
      backend: "supabase"
    };
  }

  return {
    allowed: true,
    remaining,
    resetAt,
    count,
    backend: "supabase"
  };
}

export async function acquireRateLimit(
  config: AppConfig,
  input: {
    routeId: string;
    principalId: string;
    clientKey: string;
  }
): Promise<RateLimitDecision> {
  const key = bucketKey(input.routeId, input.principalId, input.clientKey);

  if (config.securityEnforcement === "strict" && isSupabaseConfigured(config)) {
    return supabaseAcquire(config, key, config.rateLimitWindowMs, config.rateLimitMaxRequests);
  }

  return memoryAcquire(key, config.rateLimitWindowMs, config.rateLimitMaxRequests);
}
