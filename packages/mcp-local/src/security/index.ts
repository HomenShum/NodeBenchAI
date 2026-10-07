/**
 * security/ — NodeBench MCP Security Module
 *
 * Single import for all security primitives:
 *   import { safePath, safeExec, safeUrl, redactSecrets, auditLog } from './index.js';
 *
 * Addresses Reddit concern: "how many out of these 260 tools steal passwords?"
 * Answer: Zero, with this module enforcing boundaries at 4 layers:
 *   1. Path sandboxing — blocks reads outside project + sensitive files
 *   2. Command sandboxing — allow-list replaces bypassable deny-list
 *   3. URL validation — SSRF protection blocks private IPs/metadata endpoints
 *   4. Credential redaction — strips secrets from all tool outputs
 */

export { SecurityError, type SecurityErrorCode } from "./SecurityError.js";
export {
  type SecurityConfig,
  type SecurityMode,
  getSecurityConfig,
  setSecurityConfig,
  _resetSecurityConfigForTesting,
} from "./config.js";
export { safePath, type SafePathOpts } from "./pathSandbox.js";
export { safeExec, type SafeExecOpts, type ExecResult, _ALLOWED_PREFIXES } from "./commandSandbox.js";
export { safeUrl, safeUrlWithDnsCheck, type UrlValidationOpts } from "./urlValidator.js";
export { redactSecrets, redactObject, _resetEnvSecretsForTesting } from "./credentialRedactor.js";
export {
  auditLog,
  getAuditLog,
  flushAuditLog,
  type AuditEntry,
  _resetAuditForTesting,
} from "./auditLog.js";
