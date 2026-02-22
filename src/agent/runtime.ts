import OpenAI from 'openai';
import { MemorySystem } from '../memory/system.js';
import { ToolRegistry, ToolResult } from '../tools/registry.js';

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface SessionState {
  messages: Message[];
  summary?: string;
  lastActivity: Date;
}

/**
 * Enhanced system prompt with comprehensive guidelines
 */
const SYSTEM_PROMPT = `You are OpenAssist, a helpful AI assistant.

## Persona
- Be helpful, concise, and proactive
- Anticipate user needs and offer relevant suggestions
- Admit when you don't know something
- Stay focused on the user's goals

## Available Tools

### web_search
Search the web for current information, facts, or news.
- Use when: User asks about recent events, needs factual information, or wants to verify something
- Example: "What's the weather in London?" → use web_search
- Rate limit: 20 requests/hour

### web_fetch
Get content from a specific URL.
- Use when: User wants to read a specific article, page, or document
- Example: "Summarize this article: https://example.com/article"
- Returns first 5000 characters of page content

### search_memory
Search your long-term memory for previously remembered information.
- Use when: User references something you might have stored earlier
- Example: "What did I tell you about my meeting?"
- Automatically searches when context suggests relevant memories exist

### remember
Save important information to long-term memory.
- Use when: User explicitly asks you to remember something
- Example: "Remember that my doctor's appointment is at 3pm"
- Also use proactively when user shares significant personal info (names, preferences, commitments)
- Rate limit: 100 requests/day

### read_notes
Read from user's notes file.
- Use when: User asks to review notes or references "my notes"
- Default file: default.md
- Example: "What's in my notes?"

### write_notes
Write or append to user's notes file.
- Use when: User asks to save notes or you want to persist important info
- Supports append mode to add without overwriting
- Example: "Write to notes that I need to call John tomorrow"

## Memory Guidelines

### When to Remember (Proactively)
- User's name, preferences, interests
- Important dates, appointments, commitments
- Projects, goals, deadlines the user mentions
- Personal context that helps future interactions

### When to Search Memory
- When user references "before", "earlier", "previously"
- When user asks about something they shared
- When context suggests relevant stored information exists
- Automatically triggered by keywords like: remember, told you, I said, my, I have

### When NOT to Store
- Casual conversation, small talk
- System instructions or prompts
- Information user explicitly says not to remember

## Reminder Handling

### Creating Reminders
- When user says "remind me to...", "set a reminder for..."
- Parse: what, when, frequency (once/daily/weekly)
- Confirm reminder details before creating

### Suggesting Reminders
- Proactively suggest reminders when user mentions future commitments
- Example: User says "I have a call on Friday" → "Would you like me to set a reminder for that?"

### Handling Reminder Queries
- List active reminders when asked
- Can cancel/modify reminders

## Error Handling

When tools fail:
1. Try to understand what went wrong
2. Provide clear, human-readable error messages
3. Suggest alternatives when possible
4. Never expose internal error details to users

Example error responses:
- "I couldn't fetch that page - it might be unavailable. Want me to try a different source?"
- "The search service is temporarily slow. Let me try again with a simpler query."
- "I had trouble saving that to memory. Would you like me to try again?"`;

/**
 * Prompt for summarizing conversation history
 */
const SUMMARIZATION_PROMPT = `Summarize this conversation concisely, preserving:
- Key topics discussed
- Important information shared by the user
- Any decisions or commitments made
- User preferences or context

Keep it brief - maximum 5 sentences. This summary will be used as context for future messages.`;

/**
 * Prompt for determining when to auto-search memory
 */
const AUTO_MEMORY_SEARCH_PROMPT = `Given the user's message, should I search my memory for relevant information?
Message: "{message}"

Respond with ONLY "YES" or "NO".
- YES if the message references something from past conversations, mentions "my", "I told you", "before", "remember when"
- NO if it's a new topic or casual greeting`;

export class Agent {
  private openai: OpenAI;
  private memory: MemorySystem;
  private tools: ToolRegistry;
  private sessions: Map<string, SessionState> = new Map();
  private readonly MAX_TURNS = 50;
  private readonly CONTEXT_SUMMARIZE_THRESHOLD = 30;
  private readonly SUMMARIZE_BATCH_SIZE = 20;

  constructor(memory: MemorySystem, tools: ToolRegistry) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    this.memory = memory;
    this.tools = tools;
  }

  /**
   * Check if we should auto-search memory based on user message
   */
  private async shouldAutoSearchMemory(userMessage: string): Promise<boolean> {
    try {
      const prompt = AUTO_MEMORY_SEARCH_PROMPT.replace('{message}', userMessage);
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 10
      });
      return response.choices[0]?.message?.content?.trim().toUpperCase() === 'YES';
    } catch {
      // Fallback: simple keyword check
      const keywords = ['my ', 'i told you', 'remember when', 'before', 'earlier', 'previously'];
      return keywords.some(k => userMessage.toLowerCase().includes(k));
    }
  }

  /**
   * Summarize old messages and replace them with a brief summary
   */
  private async summarizeContext(session: SessionState, userId: string): Promise<string> {
    // Get messages to summarize (skip system message)
    const messagesToSummarize = session.messages.slice(1, this.SUMMARIZE_BATCH_SIZE + 1);
    
    if (messagesToSummarize.length === 0) {
      return session.summary || '';
    }

    // Build conversation for summarization
    const conversationText = messagesToSummarize
      .map(m => `${m.role}: ${m.content}`)
      .join('\n\n');

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SUMMARIZATION_PROMPT },
          { role: 'user', content: conversationText }
        ],
        temperature: 0.3,
        max_tokens: 300
      });

      const summary = response.choices[0]?.message?.content || '';
      
      // Update session with summary
      session.summary = summary;
      
      // Remove summarized messages, keep recent ones
      const recentMessages = session.messages.slice(this.SUMMARIZE_BATCH_SIZE);
      session.messages = [session.messages[0], ...recentMessages];

      console.log(`📝 Context summarized: ${messagesToSummarize.length} messages → ${summary.length} chars`);
      
      return summary;
    } catch (error) {
      console.error('Summarization failed:', error);
      // Fallback: just prune old messages without summary
      session.messages = session.messages.slice(this.SUMMARIZE_BATCH_SIZE / 2);
      return '';
    }
  }

  /**
   * Get the effective system prompt with session summary if available
   */
  private getEffectiveSystemPrompt(session: SessionState): string {
    if (session.summary) {
      return `${SYSTEM_PROMPT}\n\n## Previous Conversation Summary\n${session.summary}\n\nThe messages below continue from this summary.`;
    }
    return SYSTEM_PROMPT;
  }

  /**
   * Check if user is asking about reminders
   */
  private isReminderQuery(userMessage: string): boolean {
    const keywords = ['reminder', 'remind me', 'reminders', 'schedule', 'appointments'];
    return keywords.some(k => userMessage.toLowerCase().includes(k));
  }

  /**
   * Handle reminder-related queries
   */
  private async handleReminderQuery(userId: string, userMessage: string): Promise<string | null> {
    // Check if it's asking to list reminders
    if (userMessage.toLowerCase().includes('list') || userMessage.toLowerCase().includes('what')) {
      try {
        const reminders = await this.memory.getRemindersByUser(userId);
        if (reminders.length === 0) {
          return "You don't have any active reminders.";
        }
        const list = reminders
          .filter(r => r.active)
          .map(r => `- ${r.message} (${r.schedule}, next: ${new Date(r.next_run).toLocaleString()})`)
          .join('\n');
        return `Your active reminders:\n${list}`;
      } catch (error) {
        console.error('Error fetching reminders:', error);
        return null;
      }
    }
    return null;
  }

  async process(userId: string, userMessage: string): Promise<string> {
    // Get or create session
    let session = this.sessions.get(userId);
    if (!session) {
      session = {
        messages: [{ role: 'system', content: SYSTEM_PROMPT }],
        lastActivity: new Date()
      };
      this.sessions.set(userId, session);
    }

    // Update last activity
    session.lastActivity = new Date();

    // Check for reminder queries first
    if (this.isReminderQuery(userMessage)) {
      const reminderResponse = await this.handleReminderQuery(userId, userMessage);
      if (reminderResponse) {
        return reminderResponse;
      }
    }

    // Auto-search memory if relevant
    const shouldSearch = await this.shouldAutoSearchMemory(userMessage);
    let memoryContext = '';
    if (shouldSearch) {
      try {
        const searchQuery = userMessage.replace(/^(what|do you|can you)\s+/i, '').slice(0, 100);
        memoryContext = await this.memory.search(searchQuery, userId);
        if (memoryContext && memoryContext !== 'No memories found') {
          console.log('🔍 Auto-searched memory:', memoryContext.slice(0, 100));
        }
      } catch (error) {
        console.warn('Memory search failed:', error);
      }
    }

    // Check if we need to summarize context
    if (session.messages.length > this.CONTEXT_SUMMARIZE_THRESHOLD) {
      await this.summarizeContext(session, userId);
    }

    // Build messages array with optional memory context
    const messages: Message[] = [...session.messages];
    
    // Add memory context as a system hint if relevant
    if (memoryContext) {
      messages.push({
        role: 'system',
        content: `Related memory: ${memoryContext}`
      });
    }

    // Add user message
    messages.push({ role: 'user', content: userMessage });

    // Prune if too long (safety check)
    if (messages.length > this.MAX_TURNS + 10) {
      const systemMsg = messages[0];
      const summaryMsg = session.summary ? { role: 'system' as const, content: `Summary: ${session.summary}` } : null;
      const recent = messages.slice(-this.MAX_TURNS + 1);
      messages.length = 0;
      messages.push(systemMsg);
      if (summaryMsg) messages.push(summaryMsg);
      messages.push(...recent);
    }

    try {
      // Get available tools
      const toolDefs = this.tools.getDefinitions();

      // Call OpenAI with tools
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        temperature: 0.7
      });

      const choice = response.choices[0];
      
      if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
        // Handle tool calls
        const toolResults: { name: string; content: string }[] = [];

        for (const call of choice.message.tool_calls) {
          const result = await this.executeTool(userId, call.function.name, call.function.arguments);
          toolResults.push({ name: call.function.name, content: result });
        }

        // Add assistant message with tool calls
        messages.push(choice.message as Message);

        // Add tool results
        for (const result of toolResults) {
          // Check if tool execution had errors
          let resultContent = result.content;
          try {
            const parsed = JSON.parse(result.content);
            if (parsed.error) {
              // Provide user-friendly error message
              resultContent = `Error: ${parsed.error}`;
            }
          } catch {
            // Not JSON, use as-is
          }
          
          messages.push({
            role: 'system' as const,
            content: `Tool ${result.name} result: ${resultContent}`
          });
        }

        // Get final response
        const finalResponse = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: messages as OpenAI.Chat.ChatCompletionMessageParam[]
        });

        const finalMessage = finalResponse.choices[0].message.content || '';
        messages.push({ role: 'assistant', content: finalMessage });
        
        // Update session
        session.messages = messages.slice(0, this.MAX_TURNS);
        
        return finalMessage;
      }

      // No tool calls, return direct response
      const assistantMessage = choice.message.content || '';
      messages.push({ role: 'assistant', content: assistantMessage });
      
      // Update session
      session.messages = messages.slice(0, this.MAX_TURNS);
      
      return assistantMessage;
    } catch (error) {
      console.error('Agent error:', error);
      
      // Provide user-friendly error message
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      if (errorMessage.includes('rate limit') || errorMessage.includes('Rate limit')) {
        return "I've hit a rate limit. Please wait a moment and try again.";
      }
      
      if (errorMessage.includes('API key') || errorMessage.includes('api key')) {
        return "There's an API configuration issue. Please check the setup.";
      }
      
      return "Sorry, I encountered an error processing your request. Please try again.";
    }
  }

  private async executeTool(userId: string, name: string, argsStr: string): Promise<string> {
    try {
      let args;
      try {
        args = JSON.parse(argsStr);
      } catch {
        return JSON.stringify({ error: 'Invalid tool arguments' });
      }
      const result = await this.tools.execute(name, args, this.memory, userId);
      
      // Check for rate limiting in result
      try {
        const parsed = JSON.parse(result);
        if (parsed.rateLimited) {
          console.warn(`⚠️ Rate limited: ${name} for user ${userId}`);
        }
      } catch {
        // Not JSON, proceed normally
      }
      
      return result;
    } catch (error) {
      console.error(`Tool ${name} error:`, error);
      
      // Provide structured error for graceful handling
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return JSON.stringify({ 
        error: 'Tool execution failed',
        details: errorMessage.includes('fetch') ? 'Network request failed' : errorMessage,
        tool: name
      });
    }
  }

  async sendToUser(userId: string, message: string): Promise<void> {
    // This will be called by external services (Telegram, reminders)
    // For now, just log it - actual delivery handled by channel
    console.log(`📤 To ${userId}: ${message}`);
  }

  clearSession(userId: string): void {
    this.sessions.delete(userId);
    console.log(`🗑️ Session cleared for user ${userId}`);
  }

  /**
   * Get session info for debugging
   */
  getSessionInfo(userId: string): { messageCount: number; hasSummary: boolean; lastActivity: Date } | null {
    const session = this.sessions.get(userId);
    if (!session) return null;
    
    return {
      messageCount: session.messages.length,
      hasSummary: !!session.summary,
      lastActivity: session.lastActivity
    };
  }

  /**
   * Clean up old sessions (call periodically)
   */
  cleanupSessions(maxAgeMinutes: number = 60): number {
    const now = new Date();
    let cleaned = 0;
    
    for (const [userId, session] of this.sessions.entries()) {
      const age = (now.getTime() - session.lastActivity.getTime()) / (1000 * 60);
      if (age > maxAgeMinutes) {
        this.sessions.delete(userId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} old sessions`);
    }
    
    return cleaned;
  }
}
