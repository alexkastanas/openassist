import { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  REST, 
  Routes,
  SlashCommandBuilder,
  Message,
} from 'discord.js';
import { Agent } from '../agent/runtime.js';
import { ReminderService } from '../reminders/service.js';
import { ChannelInterface, parseReminder } from './base.js';

/**
 * Discord channel implementation for OpenAssist
 */
export class DiscordChannel implements ChannelInterface {
  private client: Client | null = null;
  private agent: Agent;
  private reminderService: ReminderService | null = null;
  private readonly COMMAND_NAME = 'ask';
  private readonly REMIND_COMMAND_NAME = 'remind';
  private readonly MEMORY_COMMAND_NAME = 'memory';

  constructor(agent: Agent) {
    this.agent = agent;
  }

  /**
   * Set the reminder service for handling /remind commands
   */
  setReminderService(service: ReminderService): void {
    this.reminderService = service;
  }

  /**
   * Check if Discord is configured
   */
  isConfigured(): boolean {
    return !!process.env.DISCORD_BOT_TOKEN;
  }

  async initialize(): Promise<void> {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      console.log('⚠️ DISCORD_BOT_TOKEN not set, Discord disabled');
      return;
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    // Register slash commands
    await this.registerSlashCommands();

    // Handle ready event
    this.client.once('ready', () => {
      console.log(`🤖 Discord bot logged in as ${this.client?.user?.tag}`);
    });

    // Handle slash commands
    this.client.on('interactionCreate', async (interaction: any) => {
      if (!interaction.isCommand()) return;
      
      const userId = interaction.user.id;
      const username = interaction.user.username;

      if (interaction.commandName === this.COMMAND_NAME) {
        await this.handleAskCommand(interaction, userId, username);
      } else if (interaction.commandName === this.REMIND_COMMAND_NAME) {
        await this.handleRemindCommand(interaction, userId);
      } else if (interaction.commandName === this.MEMORY_COMMAND_NAME) {
        await this.handleMemoryCommand(interaction, userId);
      }
    });

    // Handle regular messages (mentions and DMs)
    this.client.on('messageCreate', async (message: Message) => {
      // Ignore bots
      if (message.author.bot) return;
      
      // Skip if it's a command (starts with /)
      if (message.content.startsWith('/')) return;

      // Check if bot is mentioned in guild message
      const isMentioned = message.mentions.has(this.client!.user!);
      const isDm = message.guild === null;
      
      if (isMentioned || isDm) {
        await this.handleMessage(message, message.author.id, message.author.username);
      }
    });

    // Login
    await this.client.login(token);
    console.log('✅ Discord bot initialized');
  }

  /**
   * Register slash commands with Discord
   */
  private async registerSlashCommands(): Promise<void> {
    const token = process.env.DISCORD_BOT_TOKEN;
    const guildId = process.env.DISCORD_GUILD_ID;
    
    if (!token || !this.client) return;

    const rest = new REST().setToken(token);

    const commands = [
      new SlashCommandBuilder()
        .setName(this.COMMAND_NAME)
        .setDescription('Ask OpenAssist a question')
        .addStringOption(option =>
          option.setName('question')
            .setDescription('Your question')
            .setRequired(true)
        ),
      new SlashCommandBuilder()
        .setName(this.REMIND_COMMAND_NAME)
        .setDescription('Set a reminder')
        .addStringOption(option =>
          option.setName('when')
            .setDescription('When to remind (e.g., "in 20 minutes", "daily", "every monday")')
            .setRequired(true)
        )
        .addStringOption(option =>
          option.setName('message')
            .setDescription('What to remember')
            .setRequired(true)
        ),
      new SlashCommandBuilder()
        .setName(this.MEMORY_COMMAND_NAME)
        .setDescription('Manage your memory')
        .addStringOption(option =>
          option.setName('action')
            .setDescription('Action: read, remember, or search')
            .setRequired(true)
            .addChoices(
              { name: 'Read notes', value: 'read' },
              { name: 'Remember something', value: 'remember' },
              { name: 'Search memory', value: 'search' }
            )
        )
        .addStringOption(option =>
          option.setName('content')
            .setDescription('Content to remember or search for')
            .setRequired(false)
        ),
    ];

    try {
      if (guildId) {
        // Register to specific guild (faster, immediate)
        await rest.put(
          Routes.applicationGuildCommands(this.client.user!.id, guildId),
          { body: commands }
        );
        console.log(`✅ Registered slash commands in guild ${guildId}`);
      } else {
        // Register globally (can take up to 1 hour)
        await rest.put(
          Routes.applicationCommands(this.client.user!.id),
          { body: commands }
        );
        console.log('✅ Registered global slash commands');
      }
    } catch (error) {
      console.error('Failed to register slash commands:', error);
    }
  }

  /**
   * Handle /ask command
   */
  private async handleAskCommand(
    interaction: any,
    userId: string,
    username: string
  ): Promise<void> {
    const question = interaction.options.getString('question', true);
    
    await interaction.deferReply();
    
    try {
      const response = await this.agent.process(userId, question);
      const embed = this.createResponseEmbed(response, question);
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error processing ask command:', error);
      await interaction.editReply({ 
        content: 'Sorry, I encountered an error processing your request.' 
      });
    }
  }

  /**
   * Handle /remind command
   */
  private async handleRemindCommand(
    interaction: any,
    userId: string
  ): Promise<void> {
    const when = interaction.options.getString('when', true);
    const message = interaction.options.getString('message', true);
    const reminderText = `${when} ${message}`;
    
    await interaction.deferReply();
    
    try {
      if (this.reminderService) {
        const result = await this.reminderService.addReminder(userId, reminderText);
        
        const embed = new EmbedBuilder()
          .setColor(0x4ade80)
          .setTitle('⏰ Reminder Set')
          .setDescription(result)
          .setTimestamp();
        
        await interaction.editReply({ embeds: [embed] });
      } else {
        // Fallback: parse and show what would be set
        const parsed = parseReminder(reminderText);
        if (parsed.success) {
          const embed = new EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle('⏰ Reminder (Preview)')
            .addFields(
              { name: 'When', value: parsed.schedule || 'once', inline: true },
              { name: 'What', value: parsed.message || message, inline: true }
            )
            .setFooter({ text: 'Reminder service not connected' })
            .setTimestamp();
          
          await interaction.editReply({ embeds: [embed] });
        } else {
          await interaction.editReply({
            content: `⚠️ ${parsed.error || 'Could not parse reminder'}`
          });
        }
      }
    } catch (error) {
      console.error('Error creating reminder:', error);
      await interaction.editReply({ 
        content: '❌ Failed to create reminder. Try a simpler format like "in 20 minutes call mom"' 
      });
    }
  }

  /**
   * Handle /memory command
   */
  private async handleMemoryCommand(
    interaction: any,
    userId: string
  ): Promise<void> {
    const action = interaction.options.getString('action', true);
    const content = interaction.options.getString('content', false) || '';
    
    await interaction.deferReply();
    
    try {
      let response: string;
      let embed: EmbedBuilder;
      
      switch (action) {
        case 'read':
          response = await this.agent.process(userId, '[system: read notes]');
          embed = this.createResponseEmbed(response || 'No notes found', 'Your Notes');
          break;
          
        case 'remember':
          if (!content) {
            await interaction.editReply({
              content: 'Please provide content to remember. Usage: /memory remember your text here'
            });
            return;
          }
          response = await this.agent.process(userId, `Remember: ${content}`);
          embed = this.createResponseEmbed(response, 'Memory Updated');
          break;
          
        case 'search':
          if (!content) {
            await interaction.editReply({
              content: 'Please provide a search query. Usage: /memory search <query>'
            });
            return;
          }
          response = await this.agent.process(userId, `[system: search memory for "${content}"]`);
          embed = this.createResponseEmbed(response || 'No memories found', `Search: ${content}`);
          break;
          
        default:
          response = 'Unknown action';
          embed = this.createResponseEmbed(response, 'Memory');
      }
      
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Error handling memory command:', error);
      await interaction.editReply({ 
        content: '❌ Failed to process memory command.' 
      });
    }
  }

  /**
   * Handle regular message (mention or DM)
   */
  private async handleMessage(
    message: Message,
    userId: string,
    username: string
  ): Promise<void> {
    // Remove mention from message content
    const content = message.content
      .replace(new RegExp(`<@!?${this.client?.user?.id}>`, 'g'), '')
      .trim();
    
    if (!content) return;
    
    // Try to show typing indicator
    try {
      const channel = message.channel as any;
      if (channel?.sendTyping) {
        await channel.sendTyping();
      }
    } catch {
      // Ignore typing errors
    }
    
    try {
      const response = await this.agent.process(userId, content);
      
      // Send response (may be too long for embed, send as regular message)
      if (response.length > 4000) {
        // Split into chunks
        const chunks = this.splitMessage(response);
        for (const chunk of chunks) {
          await message.reply(chunk);
        }
      } else {
        const embed = this.createResponseEmbed(response, `Reply to ${username}`);
        await message.reply({ embeds: [embed] });
      }
    } catch (error) {
      console.error('Error processing message:', error);
      await message.reply('Sorry, I encountered an error processing your request.');
    }
  }

  /**
   * Create a rich embed for responses
   */
  private createResponseEmbed(content: string, title: string): EmbedBuilder {
    // Truncate content if too long (embed description max 4096 chars)
    const truncated = content.length > 4000 ? content.slice(0, 3997) + '...' : content;
    
    return new EmbedBuilder()
      .setColor(0x6366f1) // Indigo
      .setTitle(title)
      .setDescription(truncated)
      .setTimestamp()
      .setFooter({ text: 'OpenAssist' });
  }

  /**
   * Split long messages into chunks
   */
  private splitMessage(message: string): string[] {
    const chunks: string[] = [];
    const maxLength = 4000;
    
    for (let i = 0; i < message.length; i += maxLength) {
      chunks.push(message.slice(i, i + maxLength));
    }
    
    return chunks;
  }

  /**
   * Send a message to a user
   */
  async sendMessage(userId: string, message: string, embed?: EmbedBuilder): Promise<void> {
    if (!this.client) return;
    
    try {
      const user = await this.client.users.fetch(userId);
      if (!user) {
        console.error(`User ${userId} not found`);
        return;
      }
      
      if (embed) {
        await user.send({ embeds: [embed] });
      } else {
        await user.send(message);
      }
    } catch (error) {
      console.error('Failed to send Discord message:', error);
    }
  }

  /**
   * Send an embed to a user
   */
  async sendEmbed(userId: string, embed: EmbedBuilder): Promise<void> {
    await this.sendMessage(userId, '', embed);
  }

  /**
   * Stop the bot gracefully
   */
  stop(): void {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      console.log('🛑 Discord bot stopped');
    }
  }
}
