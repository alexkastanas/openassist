import 'dotenv/config';
import { Gateway } from './gateway/server.js';
import { TelegramChannel } from './channels/telegram.js';
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

const PORT = parseInt(process.env.PORT || '3000');
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '3001');

async function main() {
  // Validate environment variables before starting
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

  // Initialize channels
  const telegram = new TelegramChannel(agent);
  await telegram.initialize();
  logger.info('✅ Telegram bot ready');

  // Start gateway server
  const gateway = new Gateway(agent, PORT);
  await gateway.start();
  logger.info(`✅ Gateway listening on port ${PORT}`);

  // Start reminder service
  const reminders = new ReminderService(agent);
  reminders.start();
  logger.info('✅ Reminder service started');

  // Start health check server
  const healthServer = new HealthCheckServer(HEALTH_PORT);
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
  logger.info(`Health checks available at http://localhost:${HEALTH_PORT}/health and /ready`);
}

main().catch((error) => {
  logger.error('Fatal error', { error: String(error), stack: error.stack });
  process.exit(1);
});
