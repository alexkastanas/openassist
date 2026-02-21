import { Telegraf } from 'telegraf';
import { Agent } from '../agent/runtime.js';
import { ReminderService } from '../reminders/service.js';

export class TelegramChannel {
  private bot: Telegraf | null = null;
  private agent: Agent;
  private reminderService: ReminderService | null = null;

  constructor(agent: Agent) {
    this.agent = agent;
  }

  /**
   * Set the reminder service for handling /remind commands
   */
  setReminderService(service: ReminderService): void {
    this.reminderService = service;
  }

  async initialize(): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN not set');
    }

    this.bot = new Telegraf(token);

    // Handle /start command
    this.bot.command('start', async (ctx) => {
      const welcome = `👋 Welcome to OpenAssist!

I'm your AI assistant. I can help you with:
- 🔍 Web search
- 📖 Fetching web content
- 📝 Taking notes
- 💭 Remembering things
- ⏰ Setting reminders

Just chat with me naturally!

Commands:
/remind - Set a reminder
/reminders - List your reminders
/notes - Read your notes
/help - Show this help`;
      await ctx.reply(welcome);
    });

    // Handle /help command
    this.bot.command('help', async (ctx) => {
      const help = `📖 OpenAssist Commands:

/start - Start the bot
/help - Show this help
/remind - Set a reminder
/reminders - List your reminders
/notes - Read your notes

Or just chat with me naturally!

💡 Reminder examples:
/remind in 20 minutes call mom
/remind tomorrow at 9am meeting
/remind every monday team standup
/remind daily take vitamins`;
      await ctx.reply(help);
    });

    // Handle /remind command with NL parsing
    this.bot.command('remind', async (ctx) => {
      const message = ctx.message.text.replace('/remind', '').trim();
      if (!message) {
        await ctx.reply(`⏰ Usage: /remind <when> <what>

Examples:
• /remind in 20 minutes call mom
• /remind tomorrow at 9am meeting
• /remind every monday team standup
• /remind daily take vitamins

Supported formats:
• "in X minutes/hours/days"
• "tomorrow at Xam/pm"
• "every monday/tuesday/..."
• "daily" or "weekly"`);
        return;
      }

      try {
        if (this.reminderService) {
          const result = await this.reminderService.addReminder(
            ctx.from.id.toString(), 
            message
          );
          await ctx.reply(result);
        } else {
          await ctx.reply('⚠️ Reminder service not available');
        }
      } catch (error) {
        console.error('Error creating reminder:', error);
        await ctx.reply('❌ Failed to create reminder. Try a simpler format.');
      }
    });

    // Handle /reminders command to list active reminders
    this.bot.command('reminders', async (ctx) => {
      const userId = ctx.from.id.toString();
      
      if (!this.reminderService) {
        await ctx.reply('⚠️ Reminder service not available');
        return;
      }

      try {
        const reminders = await this.reminderService.getReminders(userId);
        
        if (reminders.length === 0) {
          await ctx.reply('📝 You have no active reminders.');
          return;
        }

        const activeReminders = reminders.filter(r => r.active);
        if (activeReminders.length === 0) {
          await ctx.reply('📝 You have no active reminders.');
          return;
        }

        const list = activeReminders.map((r, i) => {
          const nextRun = new Date(r.next_run);
          const timeStr = nextRun.toLocaleString([], { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric',
            hour: '2-digit', 
            minute: '2-digit' 
          });
          const scheduleEmoji = r.schedule === 'daily' ? '📅' : r.schedule === 'weekly' ? '🔄' : '⏰';
          return `${i + 1}. ${scheduleEmoji} ${r.message}\n   Next: ${timeStr}`;
        }).join('\n\n');

        await ctx.reply(`⏰ Your reminders:\n\n${list}`);
      } catch (error) {
        console.error('Error listing reminders:', error);
        await ctx.reply('❌ Failed to load reminders.');
      }
    });

    // Handle /notes command
    this.bot.command('notes', async (ctx) => {
      const notes = await this.agent.process(ctx.from.id.toString(), '[system: read notes]');
      if (notes) {
        await ctx.reply(`📝 Your notes:\n\n${notes}`);
      } else {
        await ctx.reply('📝 You have no notes yet. Just ask me to remember something!');
      }
    });

    // Handle regular messages
    this.bot.on('text', async (ctx) => {
      const userId = ctx.from.id.toString();
      const message = ctx.message.text;

      // Skip commands
      if (message.startsWith('/')) return;

      // Show typing
      await ctx.sendChatAction('typing');

      // Process message
      const response = await this.agent.process(userId, message);

      // Send response
      await ctx.reply(response);
    });

    // Start polling
    await this.bot.launch();
    console.log('📱 Telegram bot launched');
  }

  async sendMessage(userId: string, message: string): Promise<void> {
    if (!this.bot) return;
    
    try {
      await this.bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      // Try without markdown if it fails
      try {
        await this.bot.telegram.sendMessage(userId, message);
      } catch (e) {
        console.error('Failed to send Telegram message:', e);
      }
    }
  }

  stop(): void {
    this.bot?.stop();
  }
}
