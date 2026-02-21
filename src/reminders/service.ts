import cron from 'node-cron';
import { Agent } from '../agent/runtime.js';
import { MemorySystem } from '../memory/system.js';

export class ReminderService {
  private memory: MemorySystem;
  private agent: Agent;
  private task: cron.ScheduledTask | null = null;

  constructor(agent: Agent) {
    // Get memory from agent (hacky for now)
    this.agent = agent;
    this.memory = new MemorySystem();
  }

  async start(): Promise<void> {
    await this.memory.initialize();

    // Check reminders every minute
    this.task = cron.schedule('* * * * *', async () => {
      await this.checkReminders();
    });
  }

  private async checkReminders(): Promise<void> {
    try {
      const due = await this.memory.getActiveReminders();
      
      for (const reminder of due) {
        console.log(`⏰ Reminder for ${reminder.user_id}: ${reminder.message}`);
        
        // Send reminder via agent (which will deliver to user)
        await this.agent.sendToUser(reminder.user_id, `⏰ Reminder: ${reminder.message}`);
        
        // Mark complete or reschedule
        await this.memory.completeReminder(reminder.id);
      }
    } catch (error) {
      console.error('Error checking reminders:', error);
    }
  }

  async addReminder(userId: string, message: string, schedule: string, minutesFromNow: number = 60): Promise<void> {
    const nextRun = new Date();
    nextRun.setMinutes(nextRun.getMinutes() + minutesFromNow);
    
    await this.memory.addReminder(userId, message, schedule, nextRun);
  }

  stop(): void {
    this.task?.stop();
    this.memory.close();
  }
}
