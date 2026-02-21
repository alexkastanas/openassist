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

export class ToolRegistry {
  private tools: Map<string, (args: Record<string, unknown>, memory: MemorySystem) => Promise<string>> = new Map();

  constructor() {
    this.registerDefaultTools();
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
    }, async (Information to rememberargs, memory) => {
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
    const defs: ToolDefinition[] = [];
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

  async execute(name: string, args: Record<string, unknown>, memory: MemorySystem): Promise<string> {
    const handler = this.tools.get(name);
    if (!handler) {
      return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
    return await handler(args, memory);
  }
}
