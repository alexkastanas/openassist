import Database from 'better-sqlite3';
import { MemorySystem } from '../memory/system.js';

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number; // milliseconds
  windowLabel: 'hour' | 'day';
}

// Rate limit configuration per tool
const RATE_LIMITS: Record<string, RateLimitConfig> = {
  web_search: { maxRequests: 20, windowMs: 60 * 60 * 1000, windowLabel: 'hour' },
  web_fetch: { maxRequests: 30, windowMs: 60 * 60 * 1000, windowLabel: 'hour' },
  remember: { maxRequests: 100, windowMs: 24 * 60 * 60 * 1000, windowLabel: 'day' },
  // Other tools are unlimited (not in this map)
};

export class ToolRegistry {
  private tools: Map<string, (args: Record<string, unknown>, memory: MemorySystem) => Promise<string>> = new Map();
  private db: Database.Database;

  constructor(dbPath?: string) {
    // Initialize SQLite database
    const actualPath = dbPath || process.cwd() + '/data/tools.db';
    this.db = new Database(actualPath);
    this.initDatabase();
    this.registerDefaultTools();
  }

  private initDatabase() {
    // Create tool_usage table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tool_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        used_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create index for faster queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tool_usage_user_tool 
      ON tool_usage(user_id, tool_name, used_at)
    `);
  }

  private registerDefaultTools() {
    // Web Search
    this.register('web_search', {
      name: 'web_search',
      description: 'Search the web for information',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' }
        },
        required: ['query']
      }
    }, async (args) => {
      const query = args.query as string;
      // Using Brave Search API via fetch
      const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`, {
        headers: {
          'Accept': 'application/json'
        }
      });
      const data = await response.json();
      return JSON.stringify(data);
    });

    // Web Fetch
    this.register('web_fetch', {
      name: 'web_fetch',
      description: 'Get content from a URL',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' }
        },
        required: ['url']
      }
    }, async (args) => {
      const url = args.url as string;
      const response = await fetch(url);
      const text = await response.text();
      // Return truncated content
      return text.slice(0, 5000);
    });

    // Search Memory
    this.register('search_memory', {
      name: 'search_memory',
      description: 'Search long-term memory for relevant information',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' }
        },
        required: ['query']
      }
    }, async (args, memory) => {
      const query = args.query as string;
      return await memory.search(query);
    });

    // Remember (save to memory)
    this.register('remember', {
      name: 'remember',
      description: 'Save important information to long-term memory',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '' }
        },
        required: ['content']
      }
    }, async (args, memory) => {
      const content = args.content as string;
      await memory.add(content);
      return 'Saved to memory';
    });

    // Read Notes
    this.register('read_notes', {
      name: 'read_notes',
      description: 'Read from user notes file',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Note filename (optional, defaults to default.md)' }
        }
      }
    }, async (args, memory) => {
      const filename = (args.filename as string) || 'default.md';
      return await memory.readNotes(filename);
    });

    // Write Notes
    this.register('write_notes', {
      name: 'write_notes',
      description: 'Write to user notes file',
      parameters: {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Note filename' },
          content: { type: 'string', description: 'Content to write' },
          append: { type: 'boolean', description: 'Append instead of overwrite' }
        },
        required: ['content']
      }
    }, async (args, memory) => {
      const filename = (args.filename as string) || 'default.md';
      const content = args.content as string;
      const append = args.append as boolean || false;
      await memory.writeNotes(filename, content, append);
      return 'Notes saved';
    });
  }

  private register(
    name: string,
    definition: ToolDefinition,
    handler: (args: Record<string, unknown>, memory: MemorySystem) => Promise<string>
  ) {
    this.tools.set(name, handler);
  }

  getDefinitions(): ToolDefinition[] {
    // Return built-in tool definitions
    return [
      {
        name: 'web_search',
        description: 'Search the web for information',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
      },
      {
        name: 'web_fetch',
        description: 'Get content from a URL',
        parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
      },
      {
        name: 'search_memory',
        description: 'Search long-term memory',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
      },
      {
        name: 'remember',
        description: 'Save to long-term memory',
        parameters: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] }
      },
      {
        name: 'read_notes',
        description: 'Read user notes',
        parameters: { type: 'object', properties: { filename: { type: 'string' } } }
      },
      {
        name: 'write_notes',
        description: 'Write user notes',
        parameters: { type: 'object', properties: { filename: { type: 'string' }, content: { type: 'string' }, append: { type: 'boolean' } }, required: ['content'] }
      }
    ];
  }

  /**
   * Check if a user is rate limited for a specific tool
   * @returns { limit: number, remaining: number, resetAt: Date | null, isLimited: boolean }
   */
  checkRateLimit(userId: string, toolName: string): { limit: number; remaining: number; resetAt: Date | null; isLimited: boolean; error?: string } {
    const config = RATE_LIMITS[toolName];
    
    // If no rate limit config exists for this tool, it's unlimited
    if (!config) {
      return { limit: -1, remaining: -1, resetAt: null, isLimited: false };
    }

    const now = new Date();
    const windowStart = new Date(now.getTime() - config.windowMs);

    // Count usage in the current window
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count 
      FROM tool_usage 
      WHERE user_id = ? AND tool_name = ? AND used_at >= ?
    `);
    
    const result = stmt.get(userId, toolName, windowStart.toISOString()) as { count: number };
    const used = result.count;
    const remaining = Math.max(0, config.maxRequests - used);
    const resetAt = new Date(now.getTime() + config.windowMs);
    const isLimited = used >= config.maxRequests;

    const windowLabel = config.windowLabel;
    const error = isLimited 
      ? `Rate limit exceeded for ${toolName}. Limit: ${config.maxRequests} per ${windowLabel}. Try again later.`
      : undefined;

    return {
      limit: config.maxRequests,
      remaining,
      resetAt,
      isLimited,
      error
    };
  }

  /**
   * Record tool usage in the database
   */
  private recordUsage(userId: string, toolName: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO tool_usage (user_id, tool_name, used_at)
      VALUES (?, ?, datetime('now'))
    `);
    stmt.run(userId, toolName);
  }

  async execute(name: string, args: Record<string, unknown>, memory: MemorySystem, userId?: string): Promise<string> {
    const handler = this.tools.get(name);
    if (!handler) {
      return JSON.stringify({ error: `Unknown tool: ${name}` });
    }

    // Check rate limit if userId is provided
    if (userId) {
      const rateLimit = this.checkRateLimit(userId, name);
      if (rateLimit.isLimited) {
        return JSON.stringify({ 
          error: rateLimit.error,
          rateLimited: true,
          limit: rateLimit.limit,
          remaining: 0,
          resetAt: rateLimit.resetAt?.toISOString()
        });
      }
    }

    // Execute the tool
    const result = await handler(args, memory);

    // Record usage after successful execution
    if (userId) {
      this.recordUsage(userId, name);
    }

    return result;
  }

  /**
   * Get usage statistics for a user
   */
  getUsageStats(userId: string, toolName?: string): { tool_name: string; count: number; window: string }[] {
    const now = new Date();
    const stats: { tool_name: string; count: number; window: string }[] = [];

    const toolsToCheck = toolName && RATE_LIMITS[toolName] 
      ? { [toolName]: RATE_LIMITS[toolName] } 
      : RATE_LIMITS;
    
    for (const [tool, config] of Object.entries(toolsToCheck)) {
      if (!config) continue;
      
      const windowStart = new Date(now.getTime() - config.windowMs);
      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count 
        FROM tool_usage 
        WHERE user_id = ? AND tool_name = ? AND used_at >= ?
      `);
      
      const result = stmt.get(userId, tool, windowStart.toISOString()) as { count: number };
      stats.push({
        tool_name: tool,
        count: result.count,
        window: config.windowLabel
      });
    }

    return stats;
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}
