import Database from 'better-sqlite3';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { connect, Connection, Table } from 'vectordb';
import OpenAI from 'openai';

// Types for our vector store
interface VectorRecord {
  id: number;
  content: string;
  embedding: number[];
}

export interface Reminder {
  id: number;
  user_id: string;
  message: string;
  schedule: 'once' | 'daily' | 'weekly';
  next_run: string;
  active: boolean;
}

export class MemorySystem {
  private db: Database.Database | null = null;
  private dataDir: string;
  private notesDir: string;
  
  // Vector database for semantic search
  private vectorDb: Connection | null = null;
  private vectorTable: Table | null = null;
  
  // OpenAI client for embeddings
  private openai: OpenAI | null = null;
  
  // In-memory vector store (backup if vectordb fails)
  private vectorStore: VectorRecord[] = [];
  private nextId = 1;

  constructor() {
    this.dataDir = join(process.cwd(), 'data');
    this.notesDir = join(this.dataDir, 'notes');
  }

  async initialize(): Promise<void> {
    // Create directories
    await mkdir(this.dataDir, { recursive: true });
    await mkdir(this.notesDir, { recursive: true });

    // Initialize SQLite
    this.db = new Database(join(this.dataDir, 'memory.db'));
    
    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        message TEXT NOT NULL,
        schedule TEXT NOT NULL,
        next_run DATETIME NOT NULL,
        active INTEGER DEFAULT 1
      );
      
      CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id);
    `);

    // Initialize OpenAI client
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    } else {
      console.warn('⚠️ OPENAI_API_KEY not found - vector search will fall back to text matching');
    }

    // Initialize vector database (in-memory)
    try {
      this.vectorDb = await connect(':memory:');
      
      // Create table with vector column
      await this.vectorDb.createTable('memories', {
        schema: {
          id: 'int32',
          content: 'string',
          embedding: 'vector(1536)', // text-embedding-3-small dimension
        }
      });
      this.vectorTable = await this.vectorDb.openTable('memories');
      console.log('🧠 Vector database initialized (in-memory)');
    } catch (error) {
      console.warn('⚠️ Vector database initialization failed, using in-memory fallback:', error);
      this.vectorTable = null;
    }

    console.log('📚 Memory system initialized');
  }

  // Generate embedding for text using OpenAI
  private async embed(text: string): Promise<number[] | null> {
    if (!this.openai) {
      console.warn('⚠️ OpenAI client not initialized');
      return null;
    }

    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      });
      return response.data[0].embedding;
    } catch (error) {
      console.error('❌ Embedding generation failed:', error);
      return null;
    }
  }

  // Compute cosine similarity between two vectors
  private cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    
    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    return dotProduct / (magnitudeA * magnitudeB);
  }

  // Long-term memory (semantic)
  async add(content: string, userId: string = 'default'): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    // Store in SQLite first
    const stmt = this.db.prepare('INSERT INTO memories (user_id, content) VALUES (?, ?)');
    const result = stmt.run(userId, content);
    const memoryId = result.lastInsertRowid as number;

    // Generate embedding and store in vector database
    const embedding = await this.embed(content);
    
    if (embedding && this.vectorTable) {
      try {
        await this.vectorTable.add([
          { id: memoryId, content, embedding }
        ]);
      } catch (error) {
        console.warn('⚠️ Failed to add to vector DB, using fallback:', error);
        this.vectorStore.push({ id: memoryId, content, embedding });
      }
    } else if (embedding) {
      // Fallback to in-memory store
      this.vectorStore.push({ id: memoryId, content, embedding });
    }
  }

  async search(query: string, userId: string = 'default', limit: number = 5): Promise<string> {
    if (!this.db) throw new Error('Database not initialized');
    
    // Try semantic search with embeddings first
    const queryEmbedding = await this.embed(query);
    
    if (queryEmbedding && (this.vectorTable || this.vectorStore.length > 0)) {
      return this.semanticSearch(query, queryEmbedding, userId, limit);
    }
    
    // Fallback to basic text search
    console.log('⚠️ Using fallback text search (no embeddings)');
    return this.textSearch(query, userId, limit);
  }

  // Semantic search using vector similarity
  private async semanticSearch(query: string, queryEmbedding: number[], userId: string, limit: number): Promise<string> {
    // Get user memories from SQLite to match user_id
    if (!this.db) throw new Error('Database not initialized');
    
    const memories = this.db.prepare(
      'SELECT id, content FROM memories WHERE user_id = ? ORDER BY created_at DESC'
    ).all(userId) as { id: number; content: string }[];

    if (memories.length === 0) {
      return 'No memories found';
    }

    // Calculate similarities using in-memory store (always available as backup)
    const resultsWithScores = await Promise.all(
      memories.map(async (memory) => {
        // Check if we have embedding in our in-memory store
        const stored = this.vectorStore.find(v => v.id === memory.id);
        if (stored?.embedding) {
          const score = this.cosineSimilarity(queryEmbedding, stored.embedding);
          return { content: memory.content, score };
        }
        
        // Generate embedding on-the-fly if not stored
        const embedding = await this.embed(memory.content);
        if (embedding) {
          const score = this.cosineSimilarity(queryEmbedding, embedding);
          return { content: memory.content, score };
        }
        
        // Fallback: text match score
        const textMatch = memory.content.toLowerCase().includes(query.toLowerCase()) ? 1 : 0;
        return { content: memory.content, score: textMatch };
      })
    );

    // Sort by similarity score descending
    resultsWithScores.sort((a, b) => b.score - a.score);

    // Return top results
    const topResults = resultsWithScores.slice(0, limit);
    return topResults.map(r => r.content).join('\n\n');
  }

  // Fallback text-based search
  private textSearch(query: string, userId: string, limit: number): string {
    if (!this.db) throw new Error('Database not initialized');
    
    // Simple LIKE search for MVP
    const stmt = this.db.prepare(`
      SELECT content FROM memories 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `);
    const results = stmt.all(userId, limit);
    
    if (results.length === 0) {
      return 'No memories found';
    }
    
    return results.map((r: any) => r.content).join('\n\n');
  }

  // Notes (file-based)
  async readNotes(filename: string, userId: string = 'default'): Promise<string> {
    try {
      const filepath = join(this.notesDir, `${userId}_${filename}`);
      return await readFile(filepath, 'utf-8');
    } catch {
      return '';
    }
  }

  async writeNotes(filename: string, content: string, append: boolean = false, userId: string = 'default'): Promise<void> {
    const filepath = join(this.notesDir, `${userId}_${filename}`);
    
    if (append) {
      const existing = await this.readNotes(filename, userId);
      content = existing + '\n' + content;
    }
    
    await writeFile(filepath, content, 'utf-8');
  }

  // Reminders
  async addReminder(userId: string, message: string, schedule: string, nextRun: Date): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');
    
    const stmt = this.db.prepare(
      'INSERT INTO reminders (user_id, message, schedule, next_run) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(userId, message, schedule, nextRun.toISOString());
    return result.lastInsertRowid as number;
  }

  async getActiveReminders(): Promise<{ id: number; user_id: string; message: string; schedule: string; next_run: string }[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      SELECT id, user_id, message, schedule, next_run 
      FROM reminders 
      WHERE active = 1 AND next_run <= ?
    `);
    return stmt.all(now) as any[];
  }

  async getRemindersByUser(userId: string): Promise<Reminder[]> {
    if (!this.db) throw new Error('Database not initialized');
    
    const stmt = this.db.prepare(`
      SELECT id, user_id, message, schedule, next_run, active 
      FROM reminders 
      WHERE user_id = ? 
      ORDER BY next_run ASC
    `);
    const results = stmt.all(userId) as any[];
    return results.map(r => ({
      id: r.id,
      user_id: r.user_id,
      message: r.message,
      schedule: r.schedule,
      next_run: r.next_run,
      active: Boolean(r.active)
    }));
  }

  async deactivateReminder(id: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    this.db.prepare('UPDATE reminders SET active = 0 WHERE id = ?').run(id);
  }

  async completeReminder(id: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    // For one-time reminders, deactivate
    // For recurring, update next_run
    const stmt = this.db.prepare('SELECT schedule FROM reminders WHERE id = ?');
    const reminder = stmt.get(id) as any;
    
    if (reminder?.schedule === 'once') {
      this.db.prepare('UPDATE reminders SET active = 0 WHERE id = ?').run(id);
    } else {
      // For daily/weekly, calculate next run
      const next = new Date();
      if (reminder?.schedule === 'daily') {
        next.setDate(next.getDate() + 1);
      } else if (reminder?.schedule === 'weekly') {
        next.setDate(next.getDate() + 7);
      }
      this.db.prepare('UPDATE reminders SET next_run = ? WHERE id = ?').run(next.toISOString(), id);
    }
  }

  close(): void {
    this.db?.close();
  }
}
