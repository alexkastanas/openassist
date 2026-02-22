import { logger } from './monitoring.js';

// ============================================================================
// Types
// ============================================================================

export interface ConfigOptions {
  TELEGRAM_BOT_TOKEN: string;
  OPENAI_API_KEY: string;
  PORT?: number;
  LOG_LEVEL?: string;
  MAX_CONVERSATION_TURNS?: number;
  HEALTH_PORT?: number;
}

export interface ConfigSchema {
  // Required
  TELEGRAM_BOT_TOKEN: string;
  OPENAI_API_KEY: string;
  // Optional with defaults
  PORT: number;
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  MAX_CONVERSATION_TURNS: number;
  HEALTH_PORT: number;
  // Derived
  isProduction: boolean;
  isDevelopment: boolean;
}

// Known environment variables (for validation)
const KNOWN_ENV_VARS = [
  'TELEGRAM_BOT_TOKEN',
  'OPENAI_API_KEY',
  'PORT',
  'LOG_LEVEL',
  'MAX_CONVERSATION_TURNS',
  'HEALTH_PORT',
  'NODE_ENV',
];

// Required environment variables
const REQUIRED_ENV_VARS = ['TELEGRAM_BOT_TOKEN', 'OPENAI_API_KEY'] as const;

// Default values
const DEFAULTS = {
  PORT: 3000,
  LOG_LEVEL: 'info' as const,
  MAX_CONVERSATION_TURNS: 10,
  HEALTH_PORT: 3001,
};

// ============================================================================
// Config Class
// ============================================================================

class ConfigImpl implements ConfigSchema {
  public readonly TELEGRAM_BOT_TOKEN: string;
  public readonly OPENAI_API_KEY: string;
  public readonly PORT: number;
  public readonly LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  public readonly MAX_CONVERSATION_TURNS: number;
  public readonly HEALTH_PORT: number;
  public readonly isProduction: boolean;
  public readonly isDevelopment: boolean;

  constructor() {
    this.validateKnownEnvVars();
    this.validateRequiredVars();

    // Required values
    this.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
    this.OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

    // Optional values with type coercion
    this.PORT = this.coerceNumber(process.env.PORT, DEFAULTS.PORT);
    this.LOG_LEVEL = this.coerceLogLevel(process.env.LOG_LEVEL, DEFAULTS.LOG_LEVEL);
    this.MAX_CONVERSATION_TURNS = this.coerceNumber(process.env.MAX_CONVERSATION_TURNS, DEFAULTS.MAX_CONVERSATION_TURNS);
    this.HEALTH_PORT = this.coerceNumber(process.env.HEALTH_PORT, DEFAULTS.HEALTH_PORT);

    // Derived values
    const nodeEnv = process.env.NODE_ENV?.toLowerCase() || 'development';
    this.isProduction = nodeEnv === 'production';
    this.isDevelopment = nodeEnv === 'development';

    logger.info('Configuration loaded successfully');
  }

  private validateRequiredVars(): void {
    const missing: string[] = [];

    for (const key of REQUIRED_ENV_VARS) {
      if (!process.env[key]) {
        missing.push(key);
      }
    }

    if (missing.length > 0) {
      logger.error('Missing required environment variables', { missing });
      console.error('\n❌ Missing required environment variables:');
      missing.forEach((m) => console.error(`   - ${m}`));
      console.error('\nPlease set these variables in your .env file and restart.');
      process.exit(1);
    }
  }

  private validateKnownEnvVars(): void {
    const envKeys = Object.keys(process.env);
    const unknownVars = envKeys.filter(
      (key) => !KNOWN_ENV_VARS.includes(key) && !key.startsWith('npm_') && !key.startsWith('NODE_')
    );

    if (unknownVars.length > 0) {
      logger.warn('Unknown environment variables detected', { unknownVars });
      console.warn('\n⚠️  Unknown environment variables:');
      unknownVars.forEach((v) => console.warn(`   - ${v}`));
    }
  }

  private coerceNumber(value: string | undefined, defaultValue: number): number {
    if (value === undefined || value === '') {
      return defaultValue;
    }
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      logger.warn(`Invalid number for env var, using default`, { value, default: defaultValue });
      return defaultValue;
    }
    return parsed;
  }

  private coerceLogLevel(value: string | undefined, defaultValue: 'debug' | 'info' | 'warn' | 'error'): 'debug' | 'info' | 'warn' | 'error' {
    if (value === undefined || value === '') {
      return defaultValue;
    }
    const normalized = value.toLowerCase();
    if (['debug', 'info', 'warn', 'error'].includes(normalized)) {
      return normalized as 'debug' | 'info' | 'warn' | 'error';
    }
    logger.warn(`Invalid LOG_LEVEL, using default`, { value, default: defaultValue });
    return defaultValue;
  }

  /**
   * Get a human-readable summary of the config (without sensitive values)
   */
  public getSummary(): Omit<ConfigSchema, 'TELEGRAM_BOT_TOKEN' | 'OPENAI_API_KEY'> & { hasTokens: boolean } {
    return {
      PORT: this.PORT,
      LOG_LEVEL: this.LOG_LEVEL,
      MAX_CONVERSATION_TURNS: this.MAX_CONVERSATION_TURNS,
      HEALTH_PORT: this.HEALTH_PORT,
      isProduction: this.isProduction,
      isDevelopment: this.isDevelopment,
      hasTokens: !!(this.TELEGRAM_BOT_TOKEN && this.OPENAI_API_KEY),
    };
  }
}

// Singleton instance
let configInstance: ConfigImpl | null = null;

/**
 * Get the global configuration instance
 * Loads and validates config on first access
 */
export function getConfig(): ConfigSchema {
  if (!configInstance) {
    configInstance = new ConfigImpl();
  }
  return configInstance;
}

/**
 * Create a new Config instance (useful for testing)
 */
export function createConfig(): ConfigSchema {
  return new ConfigImpl();
}

// ============================================================================
// Re-export for convenience
// ============================================================================

export default { getConfig };
