import cron from 'node-cron';
import { Agent } from '../agent/runtime.js';
import { MemorySystem, Reminder } from '../memory/system.js';

/**
 * Natural language parser for reminder times
 */
export class ReminderParser {
  /**
   * Parse natural language time expressions into a Date
   * Supported formats:
   * - "in 20 minutes" → now + 20 minutes
   * - "in 2 hours" → now + 2 hours
   * - "tomorrow at 9am" → next 9am
   * - "every monday" → next monday
   * - "every weekday" → next weekday
   * - "daily" → tomorrow same time
   * - "weekly" → 7 days from now
   */
  static parse(text: string): { schedule: 'once' | 'daily' | 'weekly'; nextRun: Date } {
    const lower = text.toLowerCase().trim();
    const now = new Date();
    
    // Check for recurring patterns
    if (lower.startsWith('every ') || lower.startsWith('daily') || lower.startsWith('weekly')) {
      return this.parseRecurring(lower, now);
    }
    
    // Parse one-time expressions
    return this.parseOneTime(lower, now);
  }

  private static parseRecurring(text: string, now: Date): { schedule: 'once' | 'daily' | 'weekly'; nextRun: Date } {
    const next = new Date(now);
    
    // Daily
    if (text.startsWith('daily')) {
      next.setDate(next.getDate() + 1);
      return { schedule: 'daily', nextRun: next };
    }
    
    // Weekly
    if (text.startsWith('weekly')) {
      next.setDate(next.getDate() + 7);
      return { schedule: 'weekly', nextRun: next };
    }
    
    // "every monday", "every tuesday", etc.
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (let i = 0; i < days.length; i++) {
      if (text.includes(days[i])) {
        const dayIndex = i;
        const currentDay = now.getDay();
        let daysUntil = dayIndex - currentDay;
        if (daysUntil <= 0) daysUntil += 7; // Next occurrence
        next.setDate(now.getDate() + daysUntil);
        return { schedule: 'weekly', nextRun: next };
      }
    }
    
    // "every weekday" or "every work day"
    if (text.includes('weekday') || text.includes('workday')) {
      // Find next weekday
      do {
        next.setDate(next.getDate() + 1);
      } while (next.getDay() === 0 || next.getDay() === 6);
      return { schedule: 'weekly', nextRun: next };
    }
    
    // Default to daily
    next.setDate(next.getDate() + 1);
    return { schedule: 'daily', nextRun: next };
  }

  private static parseOneTime(text: string, now: Date): { schedule: 'once' | 'daily' | 'weekly'; nextRun: Date } {
    const next = new Date(now);
    
    // "in X minutes"
    const minMatch = text.match(/in\s+(\d+)\s*(minutes?|mins?)/i);
    if (minMatch) {
      const mins = parseInt(minMatch[1]);
      next.setMinutes(next.getMinutes() + mins);
      return { schedule: 'once', nextRun: next };
    }
    
    // "in X hours"
    const hourMatch = text.match(/in\s+(\d+)\s*(hours?|hrs?)/i);
    if (hourMatch) {
      const hours = parseInt(hourMatch[1]);
      next.setHours(next.getHours() + hours);
      return { schedule: 'once', nextRun: next };
    }
    
    // "in X days"
    const dayMatch = text.match(/in\s+(\d+)\s*(days?)/i);
    if (dayMatch) {
      const days = parseInt(dayMatch[1]);
      next.setDate(next.getDate() + days);
      return { schedule: 'once', nextRun: next };
    }
    
    // "tomorrow at 9am", "tomorrow at 9:30pm"
    if (text.startsWith('tomorrow')) {
      next.setDate(next.getDate() + 1);
      return this.parseTimeInDate(text.replace(/^tomorrow\s*/i, ''), next, now);
    }
    
    // "today at 5pm", "at 9am"
    if (text.startsWith('today') || text.startsWith('at ')) {
      const timeStr = text.replace(/^(today|at)\s*/i, '');
      return this.parseTimeInDate(timeStr, next, now);
    }
    
    // Day of week: "monday", "tuesday", etc.
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (let i = 0; i < days.length; i++) {
      if (text.includes(days[i])) {
        const dayIndex = i;
        const currentDay = now.getDay();
        let daysUntil = dayIndex - currentDay;
        if (daysUntil <= 0) daysUntil += 7;
        next.setDate(now.getDate() + daysUntil);
        // Try to extract time
        const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (timeMatch) {
          return this.parseTimeInDate(text, next, now);
        }
        return { schedule: 'once', nextRun: next };
      }
    }
    
    // Default: 1 hour from now
    next.setHours(next.getHours() + 1);
    return { schedule: 'once', nextRun: next };
  }

  private static parseTimeInDate(timeStr: string, date: Date, now: Date): { schedule: 'once' | 'daily' | 'weekly'; nextRun: Date } {
    const match = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!match) {
      // No time found, default to 1 hour from now
      date.setHours(now.getHours() + 1);
      return { schedule: 'once', nextRun: date };
    }
    
    let hours = parseInt(match[1]);
    const minutes = match[2] ? parseInt(match[2]) : 0;
    const period = match[3]?.toLowerCase();
    
    // Handle 12-hour format
    if (period === 'am' && hours === 12) hours = 0;
    if (period === 'pm' && hours !== 12) hours += 12;
    
    // If the time has already passed today, move to tomorrow
    if (date.getDate() === now.getDate() && (hours < now.getHours() || (hours === now.getHours() && minutes <= now.getMinutes()))) {
      date.setDate(date.getDate() + 1);
    }
    
    date.setHours(hours, minutes, 0, 0);
    return { schedule: 'once', nextRun: date };
  }

  /**
   * Format a reminder for display to the user
   */
  static formatReminderTime(nextRun: Date): string {
    const now = new Date();
    const diff = nextRun.getTime() - now.getTime();
    const mins = Math.round(diff / 60000);
    const hours = Math.round(diff / 3600000);
    const days = Math.round(diff / 86400000);
    
    if (mins < 60) {
      return `in ${mins} minute${mins !== 1 ? 's' : ''}`;
    } else if (hours < 24) {
      return `in ${hours} hour${hours !== 1 ? 's' : ''}`;
    } else {
      return `on ${nextRun.toLocaleDateString()} at ${nextRun.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
  }
}

export class ReminderService {
  private memory: MemorySystem;
  private agent: Agent;
  private telegramChannel: { sendMessage: (userId: string, message: string) => Promise<void> } | null = null;
  private discordChannel: { sendMessage: (userId: string, message: string) => Promise<void> } | null = null;
  private task: cron.ScheduledTask | null = null;

  constructor(agent: Agent, memory?: MemorySystem) {
    this.agent = agent;
    this.memory = memory || new MemorySystem();
  }

  /**
   * Set the Telegram channel for delivery
   */
  setTelegramChannel(telegram: { sendMessage: (userId: string, message: string) => Promise<void> }): void {
    this.telegramChannel = telegram;
  }

  /**
   * Set the Discord channel for delivery
   */
  setDiscordChannel(discord: { sendMessage: (userId: string, message: string) => Promise<void> }): void {
    this.discordChannel = discord;
  }

  async start(): Promise<void> {
    await this.memory.initialize();

    // Check reminders every minute
    this.task = cron.schedule('* * * * *', async () => {
      await this.checkReminders();
    });
    
    console.log('⏰ Reminder service started');
  }

  private async checkReminders(): Promise<void> {
    try {
      const due = await this.memory.getActiveReminders();
      
      for (const reminder of due) {
        console.log(`⏰ Reminder for ${reminder.user_id}: ${reminder.message}`);
        
        // Deliver the reminder
        await this.deliverReminder(reminder);
        
        // Mark complete or reschedule
        await this.memory.completeReminder(reminder.id);
      }
    } catch (error) {
      console.error('Error checking reminders:', error);
    }
  }

  private async deliverReminder(reminder: { id: number; user_id: string; message: string; schedule: string; next_run: string }): Promise<void> {
    const message = `⏰ *Reminder:* ${reminder.message}`;
    
    // Try Telegram first
    if (this.telegramChannel) {
      try {
        await this.telegramChannel.sendMessage(reminder.user_id, message);
        return;
      } catch (error) {
        console.error('Telegram delivery failed:', error);
      }
    }
    
    // Try Discord
    if (this.discordChannel) {
      try {
        await this.discordChannel.sendMessage(reminder.user_id, message);
        return;
      } catch (error) {
        console.error('Discord delivery failed:', error);
      }
    }
    
    // Fallback to agent's sendToUser
    try {
      await this.agent.sendToUser(reminder.user_id, message);
    } catch (error) {
      console.error('Agent delivery failed:', error);
    }
  }

  /**
   * Add a reminder using natural language
   * Examples:
   * - "in 20 minutes call mom" → one-time reminder in 20 mins
   * - "tomorrow at 9am meeting" → one-time at tomorrow 9am
   * - "every monday team standup" → weekly on mondays
   * - "daily take vitamins" → daily reminder
   */
  async addReminder(userId: string, naturalLanguage: string): Promise<string> {
    // Parse the natural language
    const { schedule, nextRun } = ReminderParser.parse(naturalLanguage);
    
    // Extract message (everything after time expression)
    const message = this.extractMessage(naturalLanguage);
    
    // Save to database
    await this.memory.addReminder(userId, message, schedule, nextRun);
    
    // Format confirmation
    const timeDesc = ReminderParser.formatReminderTime(nextRun);
    const scheduleText = schedule === 'once' ? '' : ` (${schedule})`;
    
    return `✅ Reminder set: "${message}" ${timeDesc}${scheduleText}`;
  }

  /**
   * Extract the actual reminder message from natural language input
   */
  private extractMessage(input: string): string {
    const lower = input.toLowerCase();
    
    // Remove common time expressions
    let message = lower
      .replace(/^(in\s+\d+\s*(minutes?|mins?|hours?|hrs?|days?))\s*/i, '')
      .replace(/^(tomorrow| today)\s+(at\s+)?/i, '')
      .replace(/^(at\s+)/i, '')
      .replace(/^(every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekday|weekday|workday|daily|weekly))\s*/i, '')
      .trim();
    
    return message || input;
  }

  /**
   * Add a reminder with explicit parameters
   */
  async addReminderExplicit(
    userId: string, 
    message: string, 
    schedule: 'once' | 'daily' | 'weekly',
    nextRun: Date
  ): Promise<void> {
    await this.memory.addReminder(userId, message, schedule, nextRun);
  }

  /**
   * Get all active reminders for a user
   */
  async getReminders(userId: string): Promise<Reminder[]> {
    return this.memory.getRemindersByUser(userId);
  }

  /**
   * Cancel a reminder
   */
  async cancelReminder(reminderId: number): Promise<void> {
    await this.memory.deactivateReminder(reminderId);
  }

  stop(): void {
    this.task?.stop();
    this.memory.close();
    console.log('⏰ Reminder service stopped');
  }
}
