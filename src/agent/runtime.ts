import OpenAI from 'openai';
import { MemorySystem } from '../memory/system.js';
import { ToolRegistry, ToolResult } from '../tools/registry.js';

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `You are OpenAssist, a helpful AI assistant. You have access to tools to help users.

Available tools:
- web_search: Search the web for information
- web_fetch: Get content from a specific URL
- read_notes: Read from the user's notes
- write_notes: Write to the user's notes
- search_memory: Search your long-term memory for relevant information
- remember: Save important information to long-term memory

Always be helpful, concise, and use tools when needed.`;

export class Agent {
  private openai: OpenAI;
  private memory: MemorySystem;
  private tools: ToolRegistry;
  private sessions: Map<string, Message[]> = new Map();
  private readonly MAX_TURNS = 50;

  constructor(memory: MemorySystem, tools: ToolRegistry) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    this.memory = memory;
    this.tools = tools;
  }

  async process(userId: string, userMessage: string): Promise<string> {
    // Get or create session
    let session = this.sessions.get(userId);
    if (!session) {
      session = [{ role: 'system', content: SYSTEM_PROMPT }];
      this.sessions.set(userId, session);
    }

    // Add user message
    session.push({ role: 'user', content: userMessage });

    // Prune if too long
    if (session.length > this.MAX_TURNS) {
      const systemMsg = session[0];
      session = [systemMsg, ...session.slice(-this.MAX_TURNS + 1)];
      this.sessions.set(userId, session);
    }

    try {
      // Get available tools
      const toolDefs = this.tools.getDefinitions();

      // Call OpenAI with tools
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: session as OpenAI.Chat.ChatCompletionMessageParam[],
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
        session.push(choice.message as Message);

        // Add tool results
        for (const result of toolResults) {
          session.push({
            role: 'system' as const,
            content: `Tool ${result.name} result: ${result.content}`
          });
        }

        // Get final response
        const finalResponse = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: session as OpenAI.Chat.ChatCompletionMessageParam[]
        });

        const finalMessage = finalResponse.choices[0].message.content || '';
        session.push({ role: 'assistant', content: finalMessage });
        
        return finalMessage;
      }

      // No tool calls, return direct response
      const assistantMessage = choice.message.content || '';
      session.push({ role: 'assistant', content: assistantMessage });
      
      return assistantMessage;
    } catch (error) {
      console.error('Agent error:', error);
      return 'Sorry, I encountered an error. Please try again.';
    }
  }

  private async executeTool(userId: string, name: string, argsStr: string): Promise<string> {
    try {
      const args = JSON.parse(argsStr);
      return await this.tools.execute(name, args, this.memory, userId);
    } catch (error) {
      console.error(`Tool ${name} error:`, error);
      return JSON.stringify({ error: 'Tool execution failed' });
    }
  }

  async sendToUser(userId: string, message: string): Promise<void> {
    // This will be called by external services (Telegram, reminders)
    // For now, just log it - actual delivery handled by channel
    console.log(`📤 To ${userId}: ${message}`);
  }

  clearSession(userId: string): void {
    this.sessions.delete(userId);
  }
}
