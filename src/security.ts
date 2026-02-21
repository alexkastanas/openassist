import { createHmac } from 'crypto';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Security Audit Logger
 * Logs all incoming requests for security audit purposes
 */
export class SecurityAuditLogger {
  private logDir: string;
  private logFile: string;

  constructor(logDir: string = '/tmp/openassist-logs') {
    this.logDir = logDir;
    this.logFile = join(logDir, 'security-audit.log');
    this.ensureLogDir();
  }

  private ensureLogDir(): void {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  log(event: SecurityAuditEvent): void {
    const timestamp = new Date().toISOString();
    const logEntry = JSON.stringify({
      timestamp,
      ...event
    }) + '\n';

    try {
      appendFileSync(this.logFile, logEntry);
    } catch (error) {
      console.error('Failed to write security audit log:', error);
    }
  }

  logRequest(params: {
    source: string;
    userId?: string;
    ip?: string;
    action: string;
    success: boolean;
    details?: Record<string, unknown>;
  }): void {
    this.log({
      type: 'request',
      ...params
    });
  }

  logSecurityEvent(params: {
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    details?: Record<string, unknown>;
  }): void {
    this.log({
      type: 'security_event',
      ...params
    });
  }
}

export interface SecurityAuditEvent {
  type: 'request' | 'security_event';
  source?: string;
  userId?: string;
  ip?: string;
  action?: string;
  success?: boolean;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  message?: string;
  details?: Record<string, unknown>;
  timestamp?: string;
}

/**
 * Rate Limiter for per-user rate limiting
 */
export class RateLimiter {
  private requests: Map<string, UserRateLimit> = new Map();
  private windowMs: number;
  private maxRequests: number;

  constructor(windowMs: number = 60000, maxRequests: number = 30) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  /**
   * Check if a user is rate limited
   * @returns { allowed: boolean, remaining: number, resetAt: number }
   */
  check(userId: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const key = userId;

    let userLimit = this.requests.get(key);

    if (!userLimit || now > userLimit.resetAt) {
      // New window
      userLimit = {
        count: 0,
        resetAt: now + this.windowMs,
        firstRequestAt: now
      };
      this.requests.set(key, userLimit);
    }

    const remaining = Math.max(0, this.maxRequests - userLimit.count);
    const allowed = userLimit.count < this.maxRequests;

    if (allowed) {
      userLimit.count++;
    }

    return {
      allowed,
      remaining,
      resetAt: userLimit.resetAt
    };
  }

  /**
   * Reset rate limit for a user (e.g., after premium upgrade)
   */
  reset(userId: string): void {
    this.requests.delete(userId);
  }

  /**
   * Clean up expired entries (call periodically)
   */
  cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];
    this.requests.forEach((value, key) => {
      if (now > value.resetAt) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => this.requests.delete(key));
  }
}

interface UserRateLimit {
  count: number;
  resetAt: number;
  firstRequestAt: number;
}

/**
 * Webhook Verification Utilities
 */
export class WebhookVerifier {
  private secretToken: string | undefined;
  private telegramApiToken: string | undefined;

  constructor(secretToken?: string, telegramApiToken?: string) {
    this.secretToken = secretToken || process.env.TELEGRAM_WEBHOOK_SECRET;
    this.telegramApiToken = telegramApiToken || process.env.TELEGRAM_BOT_TOKEN;
  }

  /**
   * Verify the secret token for webhook authentication
   */
  verifySecretToken(secret: string | undefined): boolean {
    if (!this.secretToken) {
      // If no secret configured, skip verification (development mode)
      return true;
    }
    return secret === this.secretToken;
  }

  /**
   * Verify Telegram API token
   */
  verifyApiToken(token: string | undefined): boolean {
    if (!token || !this.telegramApiToken) {
      return false;
    }
    return token === this.telegramApiToken;
  }

  /**
   * Verify message signature (for additional security)
   * Telegram doesn't use HMAC signatures for bot API, but we can add our own
   */
  verifySignature(payload: string, signature: string, secret: string): boolean {
    const expectedSignature = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    return signature === expectedSignature;
  }

  /**
   * Generate a signature for outgoing messages
   */
  generateSignature(payload: string, secret: string): string {
    return createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
  }

  /**
   * Get the configured secret token (for webhook setup)
   */
  getSecretToken(): string | undefined {
    return this.secretToken;
  }

  /**
   * Set the secret token
   */
  setSecretToken(token: string): void {
    this.secretToken = token;
  }
}

/**
 * Security configuration
 */
export interface SecurityConfig {
  telegramApiToken?: string;
  webhookSecret?: string;
  rateLimitWindowMs?: number;
  rateLimitMaxRequests?: number;
  enableAuditLogging?: boolean;
  auditLogDir?: string;
}

/**
 * Create and configure all security utilities
 */
export function createSecurityManager(config: SecurityConfig = {}) {
  const {
    telegramApiToken,
    webhookSecret,
    rateLimitWindowMs = 60000,
    rateLimitMaxRequests = 30,
    enableAuditLogging = true,
    auditLogDir = '/tmp/openassist-logs'
  } = config;

  const auditLogger = enableAuditLogging 
    ? new SecurityAuditLogger(auditLogDir)
    : null;

  const rateLimiter = new RateLimiter(rateLimitWindowMs, rateLimitMaxRequests);
  const webhookVerifier = new WebhookVerifier(webhookSecret, telegramApiToken);

  return {
    auditLogger,
    rateLimiter,
    webhookVerifier
  };
}
