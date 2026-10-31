// Applied to operational errors and diagnostics, never used as a credential store.
export function redactSensitive(value) {
 return String(value ?? '')
  .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,'[private key redacted]')
  .replace(/\bBearer\s+[^\s"',;]+/gi,'Bearer [redacted]')
  .replace(/\b(?:sk-[\w-]{16,}|gh[pousr]_[\w]{16,}|github_pat_[\w]{16,}|AKIA[A-Z0-9]{16})\b/g,'[credential redacted]')
  .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g,'[token redacted]')
  .replace(/((?:access_token|refresh_token|id_token|api[_ -]?key|password|client_secret|cookie)\s*[=:]\s*["']?)[^\s"'&,;]+/gi,'$1[redacted]');
}
export function safeError(error) {
 return redactSensitive(error?.message || 'The operation failed.').slice(0,600);
}
