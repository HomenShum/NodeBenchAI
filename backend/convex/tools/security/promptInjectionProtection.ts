/**
 * Prompt Injection Protection - Sanitization and validation layer
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * AGENTIC CONTEXT ENGINEERING - PROMPT INJECTION PROTECTION
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * This module implements defense-in-depth against prompt injection attacks:
 * 1. INPUT SANITIZATION: Clean user inputs before they reach the agent
 * 2. CONTENT VALIDATION: Detect and neutralize injection attempts
 * 3. MEMORY PREFIXING: Clear demarcation between user and system content
 * 4. OUTPUT FILTERING: Prevent sensitive data leakage in responses
 * 
 * THREAT MODEL:
 * - Direct injection: User tries to override system instructions
 * - Indirect injection: Malicious content in retrieved documents/memory
 * - Jailbreak attempts: Bypass safety guardrails
 * - Data exfiltration: Extract system prompts or sensitive data
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Injection detection patterns
 * These patterns indicate potential prompt injection attempts
 */
const INJECTION_PATTERNS = [
  // Direct instruction override attempts
  /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)/i,
  /forget\s+(everything|all|what)\s+(you|i|we)\s+(know|learned|were told)/i,
  /disregard\s+(your|the|all)\s+(instructions?|guidelines?|rules?)/i,
  /override\s+(your|the|system)\s+(prompt|instructions?)/i,
  
  // Role manipulation attempts
  /you\s+are\s+now\s+(a|an|the)\s+[a-z]+\s+(that|who|which)/i,
  /pretend\s+(you\s+are|to\s+be)\s+(a|an)\s+/i,
  /act\s+as\s+(if\s+you\s+are|a|an)\s+/i,
  /from\s+now\s+on[,\s]+(you|your)\s+(will|are|should)/i,
  
  // System prompt extraction attempts
  /what\s+(is|are)\s+your\s+(system\s+)?prompt/i,
  /show\s+(me\s+)?your\s+(initial\s+)?instructions/i,
  /reveal\s+(your\s+)?(hidden\s+)?prompt/i,
  /print\s+(your\s+)?system\s+(message|prompt)/i,
  
  // Delimiter exploitation
  /\[\s*SYSTEM\s*\]/i,
  /\[\s*ADMIN\s*\]/i,
  /\[\s*INSTRUCTIONS?\s*\]/i,
  /<\s*system\s*>/i,
  /```\s*system/i,
  
  // Code injection markers
  /<script\s*>/i,
  /javascript:/i,
  /data:text\/html/i,
];

/**
 * Sensitive patterns that should not appear in outputs
 */
const SENSITIVE_OUTPUT_PATTERNS = [
  /api[_-]?key[:\s]*[a-zA-Z0-9_-]{20,}/i,
  /secret[_-]?key[:\s]*[a-zA-Z0-9_-]{20,}/i,
  /password[:\s]*[^\s]{8,}/i,
  /bearer\s+[a-zA-Z0-9_.-]+/i,
];

/**
 * Result of injection detection
 */
export interface InjectionDetectionResult {
  isClean: boolean;
  riskLevel: "none" | "low" | "medium" | "high";
  detectedPatterns: string[];
  sanitizedContent: string;
  originalContent: string;
}

/**
 * Detect potential prompt injection attempts in content
 */
export function detectInjection(content: string): InjectionDetectionResult {
  const detectedPatterns: string[] = [];
  
  for (const pattern of INJECTION_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      detectedPatterns.push(match[0]);
    }
  }
  
  // Calculate risk level based on number and type of patterns
  let riskLevel: "none" | "low" | "medium" | "high" = "none";
  if (detectedPatterns.length >= 3) {
    riskLevel = "high";
  } else if (detectedPatterns.length === 2) {
    riskLevel = "medium";
  } else if (detectedPatterns.length === 1) {
    riskLevel = "low";
  }
  
  return {
    isClean: detectedPatterns.length === 0,
    riskLevel,
    detectedPatterns,
    sanitizedContent: sanitizeContent(content),
    originalContent: content,
  };
}

/**
 * Sanitize content by neutralizing potential injection attempts
 * This doesn't remove content, but makes it safe
 */
export function sanitizeContent(content: string): string {
  let sanitized = content;
  
  // Escape angle brackets that might be used for delimiter exploitation
  sanitized = sanitized.replace(/<(\/?)(system|admin|instructions?|script)/gi, 
    (_, slash, tag) => `＜${slash}${tag}＞`); // Use fullwidth brackets
  
  // Escape square bracket patterns that might be used as fake system markers
  sanitized = sanitized.replace(/\[\s*(SYSTEM|ADMIN|INSTRUCTIONS?)\s*\]/gi,
    (_, tag) => `［${tag}］`); // Use fullwidth brackets
  
  // Neutralize code blocks that might contain system-like content
  sanitized = sanitized.replace(/```\s*(system|admin)/gi, '```user');
  
  return sanitized;
}

/**
 * Prefix content with clear demarcation markers
 * This ensures the LLM knows the source and trust level of content
 */
export function prefixWithSourceMarker(
  content: string,
  source: "user" | "memory" | "document" | "web" | "tool",
  subtype?: string
): string {
  const marker = subtype
    ? `[${source.toUpperCase()} - ${subtype.toUpperCase()}]`
    : `[${source.toUpperCase()} CONTENT]`;

  return `${marker}\n${content}`;
}

/**
 * Filter sensitive data from output before returning to user
 */
export function filterSensitiveOutput(output: string): string {
  let filtered = output;

  for (const pattern of SENSITIVE_OUTPUT_PATTERNS) {
    filtered = filtered.replace(pattern, "[REDACTED]");
  }

  return filtered;
}

/**
 * Validate and sanitize a complete message before processing
 * Returns sanitized content and risk assessment
 */
export function validateMessage(
  content: string,
  options?: {
    allowHighRisk?: boolean;
    logDetections?: boolean;
  }
): {
  content: string;
  isValid: boolean;
  riskLevel: string;
  warnings: string[];
} {
  const detection = detectInjection(content);
  const warnings: string[] = [];

  if (detection.riskLevel === "high" && !options?.allowHighRisk) {
    warnings.push("High-risk injection patterns detected - content sanitized");
    if (options?.logDetections) {
      console.warn("[SECURITY] High-risk injection attempt:", detection.detectedPatterns);
    }
  }

  if (detection.riskLevel === "medium") {
    warnings.push("Potential injection patterns detected - content sanitized");
  }

  return {
    content: detection.sanitizedContent,
    isValid: detection.riskLevel !== "high" || options?.allowHighRisk === true,
    riskLevel: detection.riskLevel,
    warnings,
  };
}

/**
 * Create a safe context array from multiple sources
 * Each source is properly prefixed and sanitized
 */
export function buildSafeContext(
  sources: Array<{
    content: string;
    source: "user" | "memory" | "document" | "web" | "tool";
    subtype?: string;
  }>
): string[] {
  return sources.map(({ content, source, subtype }) => {
    const sanitized = sanitizeContent(content);
    return prefixWithSourceMarker(sanitized, source, subtype);
  });
}

/**
 * Wrap user input with safety boundaries
 * This creates a clear separation between user content and system instructions
 */
export function wrapUserInput(input: string): string {
  const sanitized = sanitizeContent(input);
  return `
--- BEGIN USER INPUT ---
${sanitized}
--- END USER INPUT ---
`.trim();
}

/**
 * Check if content appears to be attempting to impersonate system messages
 */
export function detectSystemImpersonation(content: string): boolean {
  const impersonationPatterns = [
    /^(system|assistant|admin):/im,
    /^\[?(system|assistant|admin)\]?:/im,
    /^<(system|assistant|admin)>/im,
  ];

  return impersonationPatterns.some(pattern => pattern.test(content));
}

/**
 * Normalize content to prevent unicode-based attacks
 * Some attacks use lookalike unicode characters
 */
export function normalizeUnicode(content: string): string {
  // Normalize to NFC form
  let normalized = content.normalize("NFC");

  // Replace common lookalike characters
  const lookalikes: Record<string, string> = {
    "ａ": "a", "ｂ": "b", "ｃ": "c", "ｄ": "d", "ｅ": "e",
    "ｆ": "f", "ｇ": "g", "ｈ": "h", "ｉ": "i", "ｊ": "j",
    "ｋ": "k", "ｌ": "l", "ｍ": "m", "ｎ": "n", "ｏ": "o",
    "ｐ": "p", "ｑ": "q", "ｒ": "r", "ｓ": "s", "ｔ": "t",
    "ｕ": "u", "ｖ": "v", "ｗ": "w", "ｘ": "x", "ｙ": "y", "ｚ": "z",
    "０": "0", "１": "1", "２": "2", "３": "3", "４": "4",
    "５": "5", "６": "6", "７": "7", "８": "8", "９": "9",
  };

  for (const [lookalike, replacement] of Object.entries(lookalikes)) {
    normalized = normalized.replace(new RegExp(lookalike, "g"), replacement);
  }

  return normalized;
}

/**
 * Full sanitization pipeline for untrusted content
 */
export function fullSanitize(
  content: string,
  source: "user" | "memory" | "document" | "web" | "tool",
  subtype?: string
): {
  sanitized: string;
  detection: InjectionDetectionResult;
  prefixed: string;
} {
  // 1. Normalize unicode
  const normalized = normalizeUnicode(content);

  // 2. Detect injection attempts
  const detection = detectInjection(normalized);

  // 3. Sanitize content
  const sanitized = detection.sanitizedContent;

  // 4. Add source prefix
  const prefixed = prefixWithSourceMarker(sanitized, source, subtype);

  return { sanitized, detection, prefixed };
}

