# OpenClaw Wrapper - MVP Specification

## Project Overview

**Name:** OpenAssist (working title)
**Purpose:** Simplified OpenClaw for non-technical users — a persistent AI assistant that knows their business
**Target:** Business owners, CEOs, professionals who want AI help without devops

---

## MVP Scope (Version 1.0)

### What's Included

| Feature | Description |
|---------|-------------|
| **1 Channel** | Telegram bot (easiest to set up) |
| **Basic Tools** | Web search, web fetch, read files, write notes |
| **Memory** | Session memory + long-term (vector store) |
| **Reminders** | Cron-based reminders delivered to chat |
| **Logging** | All conversations logged, exportable |
| **Easy Deploy** | One Docker command |

### What's NOT Included (v1.0)

- Exec/shell access
- Multiple channels
- Custom plugins
- Code execution
- Browser automation
- Voice/telephony

---

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Telegram   │────▶│   Gateway   │────▶│    Agent    │
│    User     │◀────│  (WebSocket)│◀────│   Runtime   │
└─────────────┘     └─────────────┘     └─────────────┘
                           │                    │
                           ▼                    ▼
                    ┌─────────────┐     ┌─────────────┐
                    │   SQLite    │     │   Tools     │
                    │  (memory)   │     │ (sandboxed)│
                    └─────────────┘     └─────────────┘
```

### Tech Stack

| Component | Technology |
|-----------|------------|
| Server | Node.js + TypeScript |
| WebSocket | ws (lightweight) |
| LLM | OpenAI API (GPT-4o mini for cost) |
| Memory | SQLite (session) + LanceDB (vectors) |
| Channel | telegraf (Telegram SDK) |
| Deployment | Docker + Docker Compose |
| Config | .env file |

---

## Core Components

### 1. Gateway Server
- WebSocket server for real-time messaging
- Message routing between Telegram and Agent
- Session management (one session per user)
- Rate limiting (prevent abuse)

### 2. Agent Runtime
- LLM loop with tool calling (OpenAI function calling)
- Prompt: Pre-configured system prompt (configurable)
- Tool definitions: Search, fetch, read, write, memory
- Timeout handling (60s max per turn)

### 3. Tool System (Sandboxed)
```typescript
// Allowed tools in v1.0
const tools = {
  web_search: { description: "Search the web", maxPerHour: 20 },
  web_fetch: { description: "Get content from URL", maxPerHour: 30 },
  read_memory: { description: "Read from long-term memory", unlimited },
  write_memory: { description: "Save to long-term memory", maxPerDay: 100 },
  read_notes: { description: "Read user's notes file", maxPerHour: 50 },
  write_notes: { description: "Write to user's notes", maxPerHour: 20 },
  get_reminders: { description: "List active reminders", unlimited },
  set_reminder: { description: "Set a reminder", maxPerDay: 10 },
};
```

### 4. Memory System
- **Session:** Last 50 messages stored in SQLite, auto-pruned
- **Long-term:** LanceDB vector store, semantic search
- **Notes:** User's personal notes file (markdown)

### 5. Reminder System
- Stored in SQLite
- Checked every minute via cron
- Delivered as Telegram message
- Supports: one-time, daily, weekly

---

## Data Models

### User
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,        -- Telegram chat_id
  name TEXT,
  created_at DATETIME,
  settings JSON               -- preferences, timezone
);
```

### Conversation
```sql
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY,
  user_id TEXT,
  role TEXT,                  -- 'user' | 'assistant'
  content TEXT,
  created_at DATETIME
);
```

### Memories (Vector)
```sql
CREATE TABLE memories (
  id INTEGER PRIMARY KEY,
  user_id TEXT,
  content TEXT,
  embedding vector(1536),
  created_at DATETIME
);
```

### Reminders
```sql
CREATE TABLE reminders (
  id INTEGER PRIMARY KEY,
  user_id TEXT,
  message TEXT,
  schedule TEXT,              -- 'once', 'daily', 'weekly'
  next_run DATETIME,
  active BOOLEAN DEFAULT true
);
```

---

## Configuration (.env)

```env
# Required
TELEGRAM_BOT_TOKEN=xxx
OPENAI_API_KEY=sk-xxx

# Optional
PORT=3000
LOG_LEVEL=info
MAX_CONVERSATION_TURNS=50
```

---

## Deployment

### Development
```bash
npm install
npm run dev
```

### Production (Docker)
```bash
docker-compose up -d
```

**Dockerfile includes:**
- Node.js 20
- Dependencies installed
- Non-root user
- Health checks

---

## Complexity Assessment

### Time Estimate

| Task | Hours | Notes |
|------|-------|-------|
| Project setup + Gateway | 4 | TypeScript, WebSocket, basic routing |
| Telegram integration | 3 | Bot commands, message handling |
| Agent runtime + LLM | 6 | Tool calling, prompt management |
| Memory system (SQLite) | 4 | Session history, pruning |
| Vector memory (LanceDB) | 5 | Embeddings, semantic search |
| Reminder system | 3 | Cron, delivery |
| Docker setup | 2 | Dockerfile, docker-compose |
| Testing + polish | 5 | Edge cases, error handling |
| **Total** | **~32 hours** | |

### Difficulty Rating: **6/10**

**Why 6/10:**
- Core logic is straightforward (message → LLM → response)
- Trickier parts: tool sandboxing, vector embeddings, reminder scheduling
- No novel research needed — well-documented patterns
- Could be simpler with fewer features, but this is lean MVP

### Risks

1. **OpenAI costs** — GPT-4o mini is cheap but needs monitoring
2. **Vector DB** — LanceDB is new, could have edge cases
3. **Telegram rate limits** — Need to handle gracefully
4. **Memory growth** — Need auto-pruning strategy

---

## Future Phases (Post-MVP)

- **v1.1:** WhatsApp channel, more tools
- **v1.2:** Multi-tenant (sell to multiple users)
- **v1.3:** Custom prompts per user
- **v1.4:** Voice input/output
- **v2.0:** Plugin system for extensibility

---

## Success Criteria for MVP

1. ✅ User can message bot on Telegram
2. ✅ Bot responds with helpful answers using web search
3. ✅ Bot remembers context across sessions
4. ✅ User can set/get reminders
5. ✅ Deploys with single Docker command
6. ✅ Costs < $10/month to run (OpenAI API)
