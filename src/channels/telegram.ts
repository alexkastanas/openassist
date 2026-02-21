import { Telegraf, Composer, Markup, Context } from 'telegraf';
import { Agent } from '../agent/runtime.js';
import { ReminderService } from '../reminders/service.js';
import { 
  SecurityAuditLogger, 
  RateLimiter, 
  WebhookVerifier,
  createSecurityManager 
} from '../security.js';

// User session state for conversation flows
interface UserSession {
  state: 'idle' | 'awaiting_reminder_time' | 'awaiting_reminder_message' | 'awaiting_note';
  tempData?: {
    reminderTime?: string;
    note?: string;
  };
}

// Extend Context to include session
interface TelegramContext extends Context {
  session?: UserSession;
}

export class TelegramChannel {
  private bot: Telegraf | null = null;
  private agent: Agent;
  private reminderService: ReminderService | null = null;
  private userSessions: Map<number, UserSession> = new Map();
  
  // Security components
  private auditLogger: SecurityAuditLogger;
  private rateLimiter: RateLimiter;
  private webhookVerifier: WebhookVerifier;

  constructor(agent: Agent) {
    this.agent = agent;
    
    // Initialize security manager
    const security = createSecurityManager({
      telegramApiToken: process.env.TELEGRAM_BOT_TOKEN,
      webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
      rateLimitWindowMs: 60000, // 1 minute window
      rateLimitMaxRequests: 30,  // 30 requests per minute per user
      enableAuditLogging: true,
      auditLogDir: process.env.SECURITY_LOG_DIR || '/tmp/openassist-logs'
    });
    
    this.auditLogger = security.auditLogger!;
    this.rateLimiter = security.rateLimiter;
    this.webhookVerifier = security.webhookVerifier;
  }

  /**
   * Set the reminder service for handling /remind commands
   */
  setReminderService(service: ReminderService): void {
    this.reminderService = service;
  }

  /**
   * Get or create user session
   */
  private getSession(ctx: TelegramContext): UserSession {
    const userId = ctx.from.id;
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, { state: 'idle' });
    }
    return this.userSessions.get(userId)!;
  }

  /**
   * Clear user session
   */
  private clearSession(ctx: TelegramContext): void {
    this.userSessions.delete(ctx.from.id);
  }

  /**
   * Handle Telegram API errors gracefully
   */
  private async safeReply(ctx: TelegramContext, message: string, extra?: any): Promise<void> {
    try {
      await ctx.reply(message, extra);
    } catch (error: any) {
      console.error('Telegram API error:', error.message);
      
      // Handle specific error codes
      if (error.message?.includes('429')) {
        // Rate limited - try again with minimal params
        try {
          await ctx.reply(message);
        } catch (retryError) {
          console.error('Retry failed:', retryError);
        }
      } else if (error.message?.includes('400')) {
        // Bad request - likely invalid keyboard or message
        try {
          await ctx.reply(message.replace(/[{}\[\]]/g, '')); // Strip markdown
        } catch (e) {
          console.error('Fallback reply failed:', e);
        }
      }
    }
  }

  /**
   * Build inline keyboard for reminder management
   */
  private reminderManagementKeyboard(reminderId: string): any {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Done', `reminder_done_${reminderId}`),
        Markup.button.callback('🗑️ Delete', `reminder_delete_${reminderId}`),
      ],
      [
        Markup.button.callback('🔔 Snooze 10m', `reminder_snooze_${reminderId}`),
      ]
    ]);
  }

  /**
   * Build inline keyboard for settings
   */
  private settingsKeyboard(): any {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('🌐 Timezone', 'settings_timezone'),
        Markup.button.callback('🔔 Notifications', 'settings_notifications'),
      ],
      [
        Markup.button.callback('📝 Notes Preferences', 'settings_notes'),
        Markup.button.callback('🔙 Back', 'settings_back'),
      ]
    ]);
  }

  /**
   * Build main menu keyboard
   */
  private mainMenuKeyboard(): any {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('⏰ Reminders', 'menu_reminders'),
        Markup.button.callback('📝 Notes', 'menu_notes'),
      ],
      [
        Markup.button.callback('⚙️ Settings', 'menu_settings'),
        Markup.button.callback('❓ Help', 'menu_help'),
      ]
    ]);
  }

  async initialize(): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN not set');
    }

    // Verify Telegram API token
    if (!this.webhookVerifier.verifyApiToken(token)) {
      this.auditLogger?.logSecurityEvent({
        severity: 'critical',
        message: 'Telegram API token verification failed',
        details: { tokenPrefix: token.substring(0, 10) + '...' }
      });
      throw new Error('Invalid Telegram API token');
    }

    // Log successful initialization
    this.auditLogger?.logRequest({
      source: 'telegram',
      action: 'initialize',
      success: true,
      details: { tokenPrefix: token.substring(0, 10) + '...' }
    });

    this.bot = new Telegraf(token);

    // Create composer for command handling
    const composer = new Composer<TelegramContext>();

    // Initialize session middleware
    composer.use(async (ctx, next) => {
      ctx.session = this.getSession(ctx);
      await next();
    });

    // Handle /start command
    composer.command('start', async (ctx) => {
      const welcome = `👋 *Welcome to OpenAssist!*

I'm your AI assistant. I can help you with:
• 🔍 Web search
• 📖 Fetching web content
• 📝 Taking notes
• 💭 Remembering things
• ⏰ Setting reminders

_Just chat with me naturally!_

Use the menu below or these commands:
/help - See all commands
/remind - Create a reminder
/notes - Read your notes
/settings - Bot settings`;

      await this.safeReply(ctx, welcome, {
        parse_mode: 'Markdown',
        ...this.mainMenuKeyboard()
      });
    });

    // Handle /help command
    composer.command('help', async (ctx) => {
      const help = `📖 *OpenAssist Commands*

*Basic:*
/start - Start the bot
/help - Show this help
/clear - Clear conversation

*Reminders:*
/remind - Create a reminder
/reminders - List active reminders
/memory - Show recent memories

*Notes:*
/notes - Read your notes
/note - Save a note

*Settings:*
/settings - Bot settings

💡 _Tip: Just chat naturally!_

Examples:
• "remind me to call mom in 20 minutes"
• "remember that my meeting is at 3pm"
• "what are my reminders?"`;

      await this.safeReply(ctx, help, {
        parse_mode: 'Markdown',
        ...this.mainMenuKeyboard()
      });
    });

    // Handle /clear command to clear conversation history
    composer.command('clear', async (ctx) => {
      const userId = ctx.from.id.toString();
      
      try {
        // Clear user session state
        this.clearSession(ctx);
        
        // Clear conversation history (if agent supports it)
        if ((this.agent as any).clearHistory) {
          await (this.agent as any).clearHistory(userId);
        }
        
        await this.safeReply(ctx, '🗑️ Conversation history cleared!', 
          Markup.inlineKeyboard([
            [Markup.button.callback('👋 Start Fresh', 'start_fresh')]
          ])
        );
      } catch (error) {
        console.error('Error clearing history:', error);
        await this.safeReply(ctx, '⚠️ Failed to clear history. Please try again.');
      }
    });

    // Handle /memory command to show recent memories
    composer.command('memory', async (ctx) => {
      try {
        const memories = await (this.agent as any).getMemories?.(ctx.from.id.toString());
        
        if (memories && memories.length > 0) {
          const memoryList = memories.slice(0, 10).map((m: any, i: number) => {
            return `${i + 1}. ${m.content || m.text || m}\n   _${new Date(m.created_at || Date.now()).toLocaleDateString()}_`;
          }).join('\n\n');
          
          await this.safeReply(ctx, `💭 *Recent Memories:*\n\n${memoryList}`, {
            parse_mode: 'Markdown'
          });
        } else {
          await this.safeReply(ctx, '💭 No memories yet. Just ask me to remember something!');
        }
      } catch (error) {
        console.error('Error getting memories:', error);
        await this.safeReply(ctx, '💭 You have no stored memories yet.');
      }
    });

    // Handle /reminders command to list active reminders with inline keyboard
    composer.command('reminders', async (ctx) => {
      const userId = ctx.from.id.toString();
      
      if (!this.reminderService) {
        await this.safeReply(ctx, '⚠️ Reminder service not available');
        return;
      }

      try {
        const reminders = await this.reminderService.getReminders(userId);
        
        if (reminders.length === 0) {
          await this.safeReply(ctx, '📝 You have no active reminders.\n\nUse /remind to create one!');
          return;
        }

        const activeReminders = reminders.filter((r: any) => r.active);
        
        if (activeReminders.length === 0) {
          await this.safeReply(ctx, '📝 You have no active reminders.\n\nUse /remind to create one!');
          return;
        }

        // Send each reminder with inline keyboard
        for (const reminder of activeReminders) {
          const nextRun = new Date(reminder.next_run);
          const timeStr = nextRun.toLocaleString([], { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric',
            hour: '2-digit', 
            minute: '2-digit' 
          });
          const scheduleEmoji = reminder.schedule === 'daily' ? '📅' : 
                               reminder.schedule === 'weekly' ? '🔄' : '⏰';
          
          await this.safeReply(ctx, 
            `${scheduleEmoji} *${reminder.message}*\n_Next: ${timeStr}_`,
            {
              parse_mode: 'Markdown',
              ...this.reminderManagementKeyboard(reminder.id)
            }
          );
        }

        // Add navigation
        await this.safeReply(ctx, 'Manage your reminders above, or use /remind to add new ones.',
          Markup.inlineKeyboard([
            [Markup.button.callback('➕ New Reminder', 'reminder_new')],
            [Markup.button.callback('🔄 Refresh', 'reminders_refresh')]
          ])
        );
      } catch (error) {
        console.error('Error listing reminders:', error);
        await this.safeReply(ctx, '❌ Failed to load reminders. Please try again.');
      }
    });

    // Handle /settings command
    composer.command('settings', async (ctx) => {
      await this.safeReply(ctx, '⚙️ *Bot Settings*\n\nChoose an option:',
        {
          parse_mode: 'Markdown',
          ...this.settingsKeyboard()
        }
      );
    });

    // Handle /remind command with NL parsing or start flow
    composer.command('remind', async (ctx) => {
      const message = ctx.message.text.replace('/remind', '').trim();
      
      if (!message) {
        // Start interactive reminder creation
        ctx.session!.state = 'awaiting_reminder_time';
        await this.safeReply(ctx, '⏰ *Create a Reminder*\n\nWhen should I remind you?\n\nExamples:\n• "in 20 minutes"\n• "tomorrow at 9am"\n• "every monday"',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('❌ Cancel', 'reminder_cancel')]
            ])
          }
        );
        return;
      }

      // Try to parse the reminder
      try {
        if (this.reminderService) {
          const result = await this.reminderService.addReminder(
            ctx.from.id.toString(), 
            message
          );
          await this.safeReply(ctx, result);
        } else {
          await this.safeReply(ctx, '⚠️ Reminder service not available');
        }
      } catch (error) {
        console.error('Error creating reminder:', error);
        await this.safeReply(ctx, '❌ Failed to create reminder. Try a simpler format like:\n/remind in 20 minutes call mom');
      }
    });

    // Handle /note command for quick note saving
    composer.command('note', async (ctx) => {
      const note = ctx.message.text.replace('/note', '').trim();
      
      if (!note) {
        ctx.session!.state = 'awaiting_note';
        await this.safeReply(ctx, '📝 *Save a Note*\n\nWhat would you like me to remember?',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('❌ Cancel', 'note_cancel')]
            ])
          }
        );
        return;
      }

      try {
        await this.agent.process(ctx.from.id.toString(), `[system: save note] ${note}`);
        await this.safeReply(ctx, `✅ Saved: "${note}"`, 
          Markup.inlineKeyboard([
            [Markup.button.callback('📝 View Notes', 'notes_view')]
          ])
        );
      } catch (error) {
        console.error('Error saving note:', error);
        await this.safeReply(ctx, '❌ Failed to save note. Please try again.');
      }
    });

    // Handle /notes command
    composer.command('notes', async (ctx) => {
      try {
        const notes = await this.agent.process(ctx.from.id.toString(), '[system: read notes]');
        
        if (notes) {
          await this.safeReply(ctx, `📝 *Your Notes:*\n\n${notes}`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('➕ Add Note', 'note_new')]
            ])
          });
        } else {
          await this.safeReply(ctx, '📝 You have no notes yet. Just ask me to remember something!',
            Markup.inlineKeyboard([
              [Markup.button.callback('➕ Add Note', 'note_new')]
            ])
          );
        }
      } catch (error) {
        console.error('Error reading notes:', error);
        await this.safeReply(ctx, '❌ Failed to load notes. Please try again.');
      }
    });

    // Handle callback queries (inline keyboard buttons)
    this.bot.action(/reminder_delete_(.+)/, async (ctx) => {
      const reminderId = ctx.match[1];
      
      try {
        if (this.reminderService) {
          await this.reminderService.deleteReminder(reminderId);
          await ctx.editMessageText('✅ Reminder deleted!');
          await ctx.answerCbQuery();
        }
      } catch (error) {
        console.error('Error deleting reminder:', error);
        await ctx.answerCbQuery('Failed to delete');
      }
    });

    this.bot.action(/reminder_done_(.+)/, async (ctx) => {
      const reminderId = ctx.match[1];
      
      try {
        if (this.reminderService) {
          await this.reminderService.completeReminder(reminderId);
          await ctx.editMessageText('✅ Great job! Reminder marked as done.');
          await ctx.answerCbQuery();
        }
      } catch (error) {
        console.error('Error completing reminder:', error);
        await ctx.answerCbQuery('Failed to complete');
      }
    });

    this.bot.action(/reminder_snooze_(.+)/, async (ctx) => {
      const reminderId = ctx.match[1];
      
      try {
        if (this.reminderService) {
          await this.reminderService.snoozeReminder(reminderId, 10); // Snooze 10 minutes
          await ctx.editMessageText('⏰ Reminder snoozed for 10 minutes!');
          await ctx.answerCbQuery();
        }
      } catch (error) {
        console.error('Error snoozing reminder:', error);
        await ctx.answerCbQuery('Failed to snooze');
      }
    });

    this.bot.action('reminder_new', async (ctx) => {
      const session = this.getSession(ctx);
      session.state = 'awaiting_reminder_time';
      
      await ctx.editMessageText('⏰ *Create a Reminder*\n\nWhen should I remind you?',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancel', 'reminder_cancel')]
          ])
        }
      );
      await ctx.answerCbQuery();
    });

    this.bot.action('reminder_cancel', async (ctx) => {
      const session = this.getSession(ctx);
      session.state = 'idle';
      session.tempData = {};
      
      await ctx.editMessageText('❌ Reminder creation cancelled.');
      await ctx.answerCbQuery();
    });

    this.bot.action('reminders_refresh', async (ctx) => {
      await ctx.deleteMessage();
      // Re-run /reminders command
      const userId = ctx.from.id.toString();
      
      if (this.reminderService) {
        const reminders = await this.reminderService.getReminders(userId);
        const activeReminders = reminders.filter((r: any) => r.active);
        
        if (activeReminders.length === 0) {
          await ctx.reply('📝 You have no active reminders.');
          return;
        }

        for (const reminder of activeReminders) {
          const nextRun = new Date(reminder.next_run);
          const timeStr = nextRun.toLocaleString();
          const scheduleEmoji = reminder.schedule === 'daily' ? '📅' : 
                               reminder.schedule === 'weekly' ? '🔄' : '⏰';
          
          await ctx.reply(
            `${scheduleEmoji} *${reminder.message}*\n_Next: ${timeStr}_`,
            {
              parse_mode: 'Markdown',
              ...this.reminderManagementKeyboard(reminder.id)
            }
          );
        }
      }
      await ctx.answerCbQuery();
    });

    this.bot.action('settings_timezone', async (ctx) => {
      await ctx.editMessageText('🌐 *Timezone Settings*\n\nCurrent timezone: UTC\n\n_Timezone selection coming soon!_',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back', 'settings_back')]
          ])
        }
      );
      await ctx.answerCbQuery();
    });

    this.bot.action('settings_notifications', async (ctx) => {
      await ctx.editMessageText('🔔 *Notification Settings*\n\n• Reminders: Enabled\n• Notes: Enabled\n• Daily summary: Disabled\n\n_Notification settings coming soon!_',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back', 'settings_back')]
          ])
        }
      );
      await ctx.answerCbQuery();
    });

    this.bot.action('settings_notes', async (ctx) => {
      await ctx.editMessageText('📝 *Notes Preferences*\n\n• Auto-save important info: On\n• Note formatting: Markdown\n\n_Preference settings coming soon!_',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back', 'settings_back')]
          ])
        }
      );
      await ctx.answerCbQuery();
    });

    this.bot.action('settings_back', async (ctx) => {
      await ctx.editMessageText('⚙️ *Bot Settings*\n\nChoose an option:',
        {
          parse_mode: 'Markdown',
          ...this.settingsKeyboard()
        }
      );
      await ctx.answerCbQuery();
    });

    this.bot.action('start_fresh', async (ctx) => {
      await ctx.editMessageText('👋 Welcome back! How can I help you today?');
      await ctx.answerCbQuery();
    });

    this.bot.action('note_new', async (ctx) => {
      const session = this.getSession(ctx);
      session.state = 'awaiting_note';
      
      await ctx.editMessageText('📝 *Save a Note*\n\nWhat would you like me to remember?',
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancel', 'note_cancel')]
          ])
        }
      );
      await ctx.answerCbQuery();
    });

    this.bot.action('note_cancel', async (ctx) => {
      const session = this.getSession(ctx);
      session.state = 'idle';
      session.tempData = {};
      
      await ctx.editMessageText('❌ Note cancelled.');
      await ctx.answerCbQuery();
    });

    this.bot.action('notes_view', async (ctx) => {
      await ctx.deleteMessage();
      try {
        const notes = await this.agent.process(ctx.from.id.toString(), '[system: read notes]');
        
        if (notes) {
          await ctx.reply(`📝 *Your Notes:*\n\n${notes}`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('➕ Add Note', 'note_new')]
            ])
          });
        } else {
          await ctx.reply('📝 You have no notes yet.');
        }
      } catch (error) {
        await ctx.reply('❌ Failed to load notes.');
      }
      await ctx.answerCbQuery();
    });

    this.bot.action('menu_reminders', async (ctx) => {
      await ctx.deleteMessage();
      const userId = ctx.from.id.toString();
      
      if (this.reminderService) {
        const reminders = await this.reminderService.getReminders(userId);
        const activeReminders = reminders.filter((r: any) => r.active);
        
        if (activeReminders.length === 0) {
          await ctx.reply('📝 You have no active reminders.\n\nUse /remind to create one!');
        } else {
          for (const reminder of activeReminders) {
            const nextRun = new Date(reminder.next_run);
            const timeStr = nextRun.toLocaleString();
            const scheduleEmoji = reminder.schedule === 'daily' ? '📅' : 
                                 reminder.schedule === 'weekly' ? '🔄' : '⏰';
            
            await ctx.reply(
              `${scheduleEmoji} *${reminder.message}*\n_Next: ${timeStr}_`,
              {
                parse_mode: 'Markdown',
                ...this.reminderManagementKeyboard(reminder.id)
              }
            );
          }
        }
      }
      await ctx.answerCbQuery();
    });

    this.bot.action('menu_notes', async (ctx) => {
      await ctx.deleteMessage();
      try {
        const notes = await this.agent.process(ctx.from.id.toString(), '[system: read notes]');
        
        if (notes) {
          await ctx.reply(`📝 *Your Notes:*\n\n${notes}`, {
            parse_mode: 'Markdown'
          });
        } else {
          await ctx.reply('📝 You have no notes yet. Just ask me to remember something!');
        }
      } catch (error) {
        await ctx.reply('❌ Failed to load notes.');
      }
      await ctx.answerCbQuery();
    });

    this.bot.action('menu_settings', async (ctx) => {
      await ctx.editMessageText('⚙️ *Bot Settings*\n\nChoose an option:',
        {
          parse_mode: 'Markdown',
          ...this.settingsKeyboard()
        }
      );
      await ctx.answerCbQuery();
    });

    this.bot.action('menu_help', async (ctx) => {
      await ctx.editMessageText(`📖 *OpenAssist Commands*

*Basic:*
/start - Start the bot
/help - Show this help
/clear - Clear conversation

*Reminders:*
/remind - Create a reminder
/reminders - List active reminders

*Notes:*
/notes - Read your notes
/note - Save a note

*Settings:*
/settings - Bot settings`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Back', 'settings_back')]
          ])
        }
      );
      await ctx.answerCbQuery();
    });

    // Add webhook secret verification middleware
    this.bot.use(async (ctx, next) => {
      // Check if secret token is provided in environment
      if (process.env.TELEGRAM_WEBHOOK_SECRET) {
        // For webhook mode, verify the secret
        const secretFromHeader = ctx.telegram?.secretToken;
        if (!this.webhookVerifier.verifySecretToken(secretFromHeader)) {
          this.auditLogger?.logSecurityEvent({
            severity: 'high',
            message: 'Webhook secret verification failed',
            userId: ctx.from?.id.toString()
          });
          // Don't throw in webhook mode to avoid loops, just log
          console.warn('Webhook secret verification failed');
        }
      }
      
      await next();
    });

    // Add rate limiting per user middleware
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id.toString();
      
      if (userId) {
        const { allowed, remaining, resetAt } = this.rateLimiter.check(userId);
        
        // Log the request
        this.auditLogger?.logRequest({
          source: 'telegram',
          userId,
          action: ctx.message?.text?.split(' ')[0] || 'text',
          success: allowed,
          details: { remaining, resetAt }
        });
        
        if (!allowed) {
          this.auditLogger?.logSecurityEvent({
            severity: 'medium',
            message: 'Rate limit exceeded',
            userId,
            details: { remaining: 0, resetAt }
          });
          
          await ctx.reply('⏳ Too many messages! Please wait a moment before sending another message.');
          return;
        }
        
        // Add rate limit info to ctx for debugging
        (ctx as any).rateLimitRemaining = remaining;
      }
      
      await next();
    });

    // Apply composer middleware
    this.bot.use(composer.middleware());

    // Handle regular messages with conversation flow
    this.bot.on('text', async (ctx) => {
      const userId = ctx.from.id.toString();
      const message = ctx.message.text;

      // Skip commands
      if (message.startsWith('/')) return;

      // Check session state for conversation flows
      const session = ctx.session!;
      
      if (session.state === 'awaiting_reminder_time') {
        session.tempData = { reminderTime: message };
        session.state = 'awaiting_reminder_message';
        
        await this.safeReply(ctx, `⏰ Got it! "${message}" - Now what should I remind you about?`,
          Markup.inlineKeyboard([
            [Markup.button.callback('❌ Cancel', 'reminder_cancel')]
          ])
        );
        return;
      }
      
      if (session.state === 'awaiting_reminder_message') {
        const timeInput = session.tempData?.reminderTime || '';
        const fullMessage = `${timeInput} ${message}`;
        
        try {
          if (this.reminderService) {
            const result = await this.reminderService.addReminder(userId, fullMessage);
            session.state = 'idle';
            session.tempData = {};
            await this.safeReply(ctx, result);
          } else {
            await this.safeReply(ctx, '⚠️ Reminder service not available');
          }
        } catch (error) {
          console.error('Error creating reminder:', error);
          await this.safeReply(ctx, '❌ Failed to create reminder. Please try again or use /remind.');
        }
        return;
      }
      
      if (session.state === 'awaiting_note') {
        try {
          await this.agent.process(userId, `[system: save note] ${message}`);
          session.state = 'idle';
          await this.safeReply(ctx, `✅ Saved: "${message}"`,
            Markup.inlineKeyboard([
              [Markup.button.callback('📝 View Notes', 'notes_view')]
            ])
          );
        } catch (error) {
          console.error('Error saving note:', error);
          await this.safeReply(ctx, '❌ Failed to save note. Please try again.');
        }
        return;
      }

      // Show typing
      await ctx.sendChatAction('typing');

      // Process message through agent
      const response = await this.agent.process(userId, message);

      // Send response
      await this.safeReply(ctx, response);
    });

    // Launch bot
    await this.bot.launch();
    console.log('📱 Telegram bot launched with enhanced commands');
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
