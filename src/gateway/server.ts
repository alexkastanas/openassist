import { WebSocketServer, WebSocket } from 'ws';
import { Agent } from '../agent/runtime.js';

interface Client {
  ws: WebSocket;
  userId: string;
}

export class Gateway {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, Client> = new Map();
  private agent: Agent;
  private port: number;

  constructor(agent: Agent, port: number) {
    this.agent = agent;
    this.port = port;
  }

  async start(): Promise<void> {
    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on('connection', (ws, req) => {
      const userId = this.getUserId(req);
      console.log(`📱 Client connected: ${userId}`);

      this.clients.set(userId, { ws, userId });

      ws.on('message', async (data) => {
        try {
          const message = data.toString();
          await this.handleMessage(userId, message);
        } catch (error) {
          console.error('Error handling message:', error);
          ws.send(JSON.stringify({ error: 'Failed to process message' }));
        }
      });

      ws.on('close', () => {
        console.log(`📱 Client disconnected: ${userId}`);
        this.clients.delete(userId);
      });

      ws.on('error', (error) => {
        console.error(`WebSocket error for ${userId}:`, error);
        this.clients.delete(userId);
      });
    });

    return new Promise((resolve) => {
      this.wss!.on('listening', () => resolve());
    });
  }

  private getUserId(req: { url?: string }): string {
    // Extract userId from query string or generate one
    const url = req.url || '/';
    const params = new URL(url, 'http://localhost').searchParams;
    return params.get('userId') || `user_${Date.now()}`;
  }

  private async handleMessage(userId: string, message: string): Promise<void> {
    const client = this.clients.get(userId);
    if (!client) return;

    // Send typing indicator
    client.ws.send(JSON.stringify({ type: 'typing', value: true }));

    // Process through agent
    const response = await this.agent.process(userId, message);

    // Send response
    client.ws.send(JSON.stringify({
      type: 'message',
      content: response,
      timestamp: new Date().toISOString()
    }));

    client.ws.send(JSON.stringify({ type: 'typing', value: false }));
  }

  async sendToUser(userId: string, message: string): Promise<void> {
    const client = this.clients.get(userId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({
        type: 'message',
        content: message,
        timestamp: new Date().toISOString()
      }));
    }
  }

  stop(): void {
    this.wss?.close();
    this.clients.clear();
  }
}
