import Database from 'better-sqlite3';
import { mkdir, readFile, writeFile, readdir } from 'fs/promises';
import { join } from 'path';

export class MemorySystem {
  private db: Database.Database | null = null;
  private dataDir: string;
  private notesDir: string;

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

    console.log('📚 Memory system initialized');
  }

  // Long-term memory (semantic)
  async add(content: string, userId: string = 'default'): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const stmt = this.db.prepare('INSERT INTO memories (user_id, content) VALUES (?, ?)');
    stmt.run(userId, content);
  }

  async search(query: string, userId: string = 'default', limit: number = 5): Promise<string> {
    if (!this.db) throw new Error('Database not initialized');
    
    // Simple LIKE search for MVP (can upgrade to vector search later)
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

  async getActiveReminders(): { id: number; user_id: string; message: string; schedule: string; next_run: string }[] {
    if (!this.db) throw new Error('Database not initialized');
    
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      SELECT id, user_id, message, schedule, next_run 
      FROM reminders 
      WHERE active = 1 AND next_run <= ?
    `);
    return stmt.all(now) as any[];
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
