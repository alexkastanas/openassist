# OpenAssist

Simplified OpenClaw for non-technical users — a persistent AI assistant that knows your business.

## Quick Start

```bash
# Clone & setup
git clone https://github.com/alexkastanas/openassist.git
cd openassist

# Configure
cp .env.example .env
# Edit .env with your tokens

# Run
docker-compose up -d
```

## Configuration

Create `.env` file:

```env
# Required
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
OPENAI_API_KEY=sk-your_openai_key

# Optional
PORT=3000
LOG_LEVEL=info
MAX_CONVERSATION_TURNS=50
```

## Usage

1. Start your bot on Telegram
2. Send `/start` to begin
3. Chat naturally — it remembers context
4. Use `/reminders` to manage reminders
5. Use `/help` for all commands

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Start the bot |
| `/help` | Show help |
| `/reminders` | List/manage reminders |
| `/clear` | Clear session memory |

## Features

- **Memory** — Remembers conversations across sessions
- **Reminders** — Set one-time or recurring reminders
- **Web Search** — Search the internet
- **Web Fetch** — Get content from URLs

## Development

```bash
npm install
npm run dev    # Dev server with hot reload
npm run build  # Production build
```

## Tech Stack

Node.js + TypeScript + Telegram + OpenAI + SQLite + LanceDB
