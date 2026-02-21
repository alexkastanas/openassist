import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { MemorySystem } from './memory/system.js';
import { Agent } from './agent/runtime.js';

// ============================================================================
// Structured Logging
// ============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  requestId?: string;
  [key: string]: any;
}

class Logger {
  private formatLevel(level: LogLevel): string {
    const colors = {
      debug: '\x1b[36m',
      info: '\x1b[32m',
      warn: '\x1b[33m',
      error: '\x1b[31m',
    };
    return `${colors[level]}${level.toUpperCase()}\x1b[0m`;
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const ctxStr = context ? ` ${JSON.stringify(context)}` : '';
    return `[${timestamp}] ${this.formatLevel(level)}: ${message}${ctxStr}`;
  }

  debug(message: string, context?: LogContext): void {
    console.debug(this.formatMessage('debug', message, context));
  }

  info(message: string, context?: LogContext): void {
    console.info(this.formatMessage('info', message, context));
  }

  warn(message: string, context?: LogContext): void {
    console.warn(this.formatMessage('warn', message, context));
  }

  error(message: string, context?: LogContext): void {
    console.error(this.formatMessage('error', message, context));
  }

  // Create a child logger with requestId
  child(requestId: string): Logger {
    const parent = this;
    return {
      debug(message: string, context?: LogContext) {
        parent.debug(message, { ...context, requestId });
      },
      info(message: string, context?: LogContext) {
        parent.info(message, { ...context, requestId });
      },
      warn(message: string, context?: LogContext) {
        parent.warn(message, { ...context, requestId });
      },
      error(message: string, context?: LogContext) {
        parent.error(message, { ...context, requestId });
      },
    };
  }
}

export const logger = new Logger();

// ============================================================================
// Environment Validation
// ============================================================================

interface EnvConfig {
  TELEGRAM_BOT_TOKEN?: string;
  OPENAI_API_KEY?: string;
  PORT?: string;
}

const REQUIRED_ENV_VARS: Array<{ key: keyof EnvConfig; description: string }> = [
  { key: 'TELEGRAM_BOT_TOKEN', description: 'Telegram bot token from @BotFather' },
  { key: 'OPENAI_API_KEY', description: 'OpenAI API key' },
];

export function validateEnvironment(): void {
  const missing: string[] = [];

  for (const { key, description } of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      missing.push(`${key} (${description})`);
    }
  }

  if (missing.length > 0) {
    logger.error('Missing required environment variables:', { missing });
    console.error('\n❌ Missing required environment variables:');
    missing.forEach((m) => console.error(`   - ${m}`));
    console.error('\nPlease set these variables in your .env file and restart.');
    process.exit(1);
  }

  logger.info('Environment validation passed');
}

// ============================================================================
// Health Checks
// ============================================================================

interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  uptime: number;
  memory: {
    used: number;
    total: number;
    percent: number;
  };
  timestamp: string;
}

interface ReadinessStatus {
  db: boolean;
  openai: boolean;
}

class HealthCheckServer {
  private server: Server | null = null;
  private startTime: number = Date.now();
  private memorySystem: MemorySystem | null = null;
  private agent: Agent | null = null;
  private port: number;

  constructor(port: number) {
    this.port = port;
  }

  setDependencies(memorySystem: MemorySystem, agent: Agent): void {
    this.memorySystem = memorySystem;
    this.agent = agent;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (err: Error) => {
        logger.error('Health check server error', { error: err.message });
        reject(err);
      });

      this.server.listen(this.port, () => {
        logger.info(`Health check server listening on port ${this.port}`);
        resolve();
      });
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url || '';
    const requestId = uuidv4();
    const log = logger.child(requestId);

    // Set CORS headers
    res.setHeader('Content-Type', 'application/json');

    if (url === '/health') {
      log.debug('Health check requested');
      const health = this.getHealth();
      res.writeHead(200);
      res.end(JSON.stringify(health));
    } else if (url === '/ready') {
      log.debug('Readiness check requested');
      this.getReadiness().then((ready) => {
        const status = ready.db && ready.openai ? 200 : 503;
        res.writeHead(status);
        res.end(JSON.stringify(ready));
      });
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  private getHealth(): HealthStatus {
    const memUsage = process.memoryUsage();
    const totalMem = memUsage.heapTotal;
    const usedMem = memUsage.heapUsed;
    const percent = (usedMem / totalMem) * 100;

    return {
      status: 'ok',
      uptime: Date.now() - this.startTime,
      memory: {
        used: Math.round(usedMem / 1024 / 1024),
        total: Math.round(totalMem / 1024 / 1024),
        percent: Math.round(percent * 100) / 100,
      },
      timestamp: new Date().toISOString(),
    };
  }

  private async getReadiness(): Promise<ReadinessStatus> {
    const status: ReadinessStatus = {
      db: false,
      openai: false,
    };

    // Check database
    try {
      // Simple DB check - if memory system is initialized, DB is ready
      status.db = this.memorySystem !== null;
    } catch {
      status.db = false;
    }

    // Check OpenAI
    try {
      // Check if agent has OpenAI client initialized
      status.openai = this.agent !== null;
    } catch {
      status.openai = false;
    }

    return status;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('Health check server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

export { HealthCheckServer };

// ============================================================================
// Graceful Shutdown
// ============================================================================

interface ShutdownOptions {
  memorySystem: MemorySystem;
  reminderService: { stop: () => void };
  healthServer: HealthCheckServer;
}

export function setupGracefulShutdown(options: ShutdownOptions): void {
  const { memorySystem, reminderService, healthServer } = options;

  const shutdown = async (signal: string): Promise<void> => {
    logger.warn(`Received ${signal}, starting graceful shutdown...`);

    try {
      // Stop accepting new connections
      logger.info('Stopping health check server...');
      await healthServer.stop();

      // Stop cron jobs
      logger.info('Stopping reminder service...');
      reminderService.stop();

      // Close database connections
      logger.info('Closing database connections...');
      memorySystem.close();

      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error: String(error) });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received');
    shutdown('SIGTERM');
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received');
    shutdown('SIGINT');
  });

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: String(error), stack: error.stack });
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
  });
}
