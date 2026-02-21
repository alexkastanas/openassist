import 'dotenv/config';
import { Gateway } from './gateway/server.js';
import { TelegramChannel } from './channels/telegram.js';
import { Agent } from './agent/runtime.js';
import { MemorySystem } from './memory/system.js';
import { ReminderService } from './reminders/service.js';
import { ToolRegistry } from './tools/registry.js';

const PORT = parseInt(process.env.PORT || '3000');

async function main() {
  console.log('🚀 Starting OpenAssist...');

  // Initialize components
  const memory = new MemorySystem();
  await memory.initialize();
  console.log('✅ Memory system initialized');

  const tools = new ToolRegistry();
  console.log('✅ Tools registered');

  const agent = new Agent(memory, tools);
  console.log('✅ Agent runtime ready');

  // Initialize channels
  const telegram = new TelegramChannel(agent);
  await telegram.initialize();
  console.log('✅ Telegram bot ready');

  // Start gateway server
  const gateway = new Gateway(agent, PORT);
  await gateway.start();
  console.log(`✅ Gateway listening on port ${PORT}`);

  // Start reminder service
  const reminders = new ReminderService(agent);
  reminders.start();
  console.log('✅ Reminder service started');

  console.log('🎉 OpenAssist is running!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
