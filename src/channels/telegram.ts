import { Telegraf } from 'telegraf';
import { Agent } from '../agent/runtime.js';

export class TelegramChannel {
  private bot: Telegraf | null = null;
  private agent: Agent;

  constructor(agent: Agent) {
    this.agent = agent;
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
/notes - Read your notes

Or just chat with me naturally!`;
      await ctx.reply(help);
    });

    // Handle /remind command
    this.bot.command('remind', async (ctx) => {
      const message = ctx.message.text.replace('/remind', '').trim();
      if (!message) {
        await ctx.reply('Usage: /remind <message> to remind you in 1 hour\nOr /remind daily <message> for daily reminders');
        return;
      }

      // Extract schedule
      let schedule = 'once';
      let reminderMessage = message;

      if (message.startsWith('daily ')) {
        schedule = 'daily';
        reminderMessage = message.replace('daily ', '');
      } else if (message.startsWith('weekly ')) {
        schedule = 'weekly';
        reminderMessage = message.replace('weekly ', '');
      }

      // For now, just confirm (reminder service handles the rest)
      await ctx.reply(`✅ I'll remind you: "${reminderMessage}"`);
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
      await this.bot.telegram.sendMessage(userId, message);
    } catch (error) {
      console.error('Failed to send Telegram message:', error);
    }
  }

  stop(): void {
    this.bot?.stop();
  }
}
