import 'dotenv/config';
import { getConfig } from './config.js';
import { Gateway } from './gateway/server.js';
import { TelegramChannel } from './channels/telegram.js';
import { DiscordChannel } from './channels/discord.js';
import { Agent } from './agent/runtime.js';
import { MemorySystem } from './memory/system.js';
import { ReminderService } from './reminders/service.js';
import { ToolRegistry } from './tools/registry.js';
import {
  logger,
  validateEnvironment,
  HealthCheckServer,
  setupGracefulShutdown,
} from './monitoring.js';

// Get config - this will fail fast if required env vars are missing
const config = getConfig();

async function main() {
  // Validate environment variables before starting (now uses config internally)
  validateEnvironment();

  const startTime = Date.now();
  logger.info('🚀 Starting OpenAssist...');

  // Initialize components
  const memory = new MemorySystem();
  await memory.initialize();
  logger.info('✅ Memory system initialized');

  const tools = new ToolRegistry();
  logger.info('✅ Tools registered');

  const agent = new Agent(memory, tools);
  logger.info('✅ Agent runtime ready');

  // Initialize Telegram channel
  const telegram = new TelegramChannel(agent);
  await telegram.initialize();
  logger.info('✅ Telegram bot ready');

  // Initialize Discord channel (optional)
  let discord: DiscordChannel | null = null;
  if (process.env.DISCORD_BOT_TOKEN) {
    discord = new DiscordChannel(agent);
    await discord.initialize();
    logger.info('✅ Discord bot ready');
  } else {
    logger.info('⏭️ Discord disabled (no token)');
  }

  // Start reminder service and connect to channels
  const reminders = new ReminderService(agent, memory);
  reminders.setTelegramChannel(telegram);
  if (discord) {
    reminders.setDiscordChannel(discord);
  }
  reminders.start();
  logger.info('✅ Reminder service started');

  // Pass reminder service to channels for /remind commands
  telegram.setReminderService(reminders);

  // Start health check server using config
  const healthServer = new HealthCheckServer(config.HEALTH_PORT);
  healthServer.setDependencies(memory, agent);
  await healthServer.start();

  // Setup graceful shutdown
  setupGracefulShutdown({
    memorySystem: memory,
    reminderService: reminders,
    healthServer,
  });

  const uptime = Date.now() - startTime;
  logger.info(`🎉 OpenAssist is running! (started in ${uptime}ms)`);
  logger.info(`Health checks available at http://localhost:${config.HEALTH_PORT}/health and /ready`);
}

main().catch((error) => {
  logger.error('Fatal error', { error: String(error), stack: error.stack });
  process.exit(1);
});
