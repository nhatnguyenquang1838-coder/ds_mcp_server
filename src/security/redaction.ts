const SECRET_KEY_PATTERNS = [
  /authorization/i,
  /cookie/i,
  /token/i,
  /secret/i,
  /password/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /client[_-]?secret/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /session/i,
  /bearer/i
];

const SECRET_TEXT_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]"],
  [/(token|secret|password|api[_-]?key|client[_-]?secret)=([^&\s]+)/gi, "$1=[REDACTED]"],
  [
    /\b[A-Za-z0-9._-]{24,}\.[A-Za-z0-9._-]{24,}\.[A-Za-z0-9._-]{24,}\b/g,
    "[REDACTED_JWT]"
  ]
];

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function redactPrimitive(value: unknown): unknown {
  if (typeof value !== "string") return value;

  return SECRET_TEXT_PATTERNS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value
  );
}

export function redactText(value: string): string {
  return String(redactPrimitive(value));
}

export function redactValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item)) as T;
  }

  if (!value || typeof value !== "object") {
    return redactPrimitive(value) as T;
  }

  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSecretKey(key) ? "[REDACTED]" : redactValue(nestedValue);
  }

  return output as T;
}
