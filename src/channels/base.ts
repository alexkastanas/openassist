import { EmbedBuilder } from 'discord.js';

/**
 * Base interface for all channel implementations
 */
export interface ChannelInterface {
  /**
   * Initialize the channel (connect to service, set up handlers)
   */
  initialize(): Promise<void>;
  
  /**
   * Send a message to a user
   */
  sendMessage(userId: string, message: string, embed?: EmbedBuilder): Promise<void>;
  
  /**
   * Stop the channel gracefully
   */
  stop(): void;
}

/**
 * Parse natural language reminder into structured format
 */
export interface ReminderParseResult {
  success: boolean;
  message?: string;
  schedule?: string;
  time?: string;
  error?: string;
}

/**
 * Parse a natural language reminder string
 */
export function parseReminder(input: string): ReminderParseResult {
  const lower = input.toLowerCase().trim();
  
  // Daily reminder
  if (lower.startsWith('daily ')) {
    return {
      success: true,
      message: input.slice(6).trim(),
      schedule: 'daily'
    };
  }
  
  // Weekly reminder (e.g., "every monday", "weekly meeting")
  const weeklyMatch = lower.match(/^every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  if (weeklyMatch) {
    return {
      success: true,
      message: input.replace(/^every\s+\w+\s*/i, '').trim(),
      schedule: 'weekly',
      time: weeklyMatch[1]
    };
  }
  
  // In X minutes/hours/days
  const inMatch = lower.match(/^in\s+(\d+)\s+(minutes?|hours?|days?)/);
  if (inMatch) {
    const amount = parseInt(inMatch[1]);
    const unit = inMatch[2];
    const schedule = unit.startsWith('minute') ? 'once' : 'once';
    return {
      success: true,
      message: input.replace(/^in\s+\d+\s+\w+\s*/i, '').trim(),
      schedule,
      time: `in ${amount} ${unit}`
    };
  }
  
  // Tomorrow at Xam/pm
  const tomorrowMatch = lower.match(/^tomorrow\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (tomorrowMatch) {
    return {
      success: true,
      message: input.replace(/^tomorrow\s+at\s+\d{1,2}(:\d{2})?\s*(am|pm)?\s*/i, '').trim(),
      schedule: 'once',
      time: `tomorrow at ${tomorrowMatch[1]}${tomorrowMatch[2] ? ':' + tomorrowMatch[2] : ''}${tomorrowMatch[3] || ''}`
    };
  }
  
  // Just a message (default to "once")
  if (input.trim().length > 0) {
    return {
      success: true,
      message: input.trim(),
      schedule: 'once'
    };
  }
  
  return {
    success: false,
    error: 'Could not parse reminder. Try: "in 20 minutes call mom" or "daily take vitamins"'
  };
}
