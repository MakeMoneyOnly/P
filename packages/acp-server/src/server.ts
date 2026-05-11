import { createServer, IncomingMessage, ServerResponse } from "node:http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import type { JsonRpcMessage, JsonRpcId, JSONRPC_VERSION } from "@paperclipai/acp-types";
import pino from "pino";

// ---------------------------------------------------------------------------
// ACP JSON-RPC Server - Express + WebSocket setup
// ---------------------------------------------------------------------------

export interface AcpServerConfig {
  port?: number;
  host?: string;
}

export type RpcHandler = (message: {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId;
  method: string;
  params: unknown;
}, ws: WebSocket, sessionId?: string) => Promise<void> | void;

/**
 * Track WebSocket connections per session for targeted notifications.
 */
interface SessionConnection {
  ws: WebSocket;
  sessionId: string;
}

export class AcpServer {
  private httpServer: ReturnType<typeof createServer> | null = null;
  private wsServer: WebSocketServer | null = null;
  private logger: pino.Logger;
  private app: express.Application;
  private sessionConnections = new Map<string, Set<WebSocket>>();

  constructor(
    private config: AcpServerConfig,
    private handler: RpcHandler
  ) {
    this.logger = pino({ name: "acp-server" });
    this.app = express();
    this.setupMiddleware();
  }

  private setupMiddleware(): void {
    this.app.use(express.json({ limit: "10mb" }));
    this.app.use((req, _res, next) => {
      this.logger.debug({ method: req.method, url: req.url }, "HTTP request");
      next();
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer = createServer(this.app);
      this.wsServer = new WebSocketServer({ server: this.httpServer });

      this.wsServer.on("connection", (ws) => {
        this.logger.info("WebSocket client connected");

        ws.on("message", async (data) => {
          try {
            const message = JSON.parse(data.toString()) as JsonRpcMessage;
            await this.handleMessage(message, ws);
          } catch (error) {
            this.sendError(ws, null, -32700, "Parse error");
          }
        });

        ws.on("close", () => {
          this.logger.info("WebSocket client disconnected");
          this.cleanupSessionConnections(ws);
        });
      });

      this.httpServer.listen(this.config.port ?? 3101, this.config.host ?? "127.0.0.1", () => {
        this.logger.info(`ACP server listening on ${this.config.host ?? "127.0.0.1"}:${this.config.port ?? 3101}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.wsServer?.close();
    this.httpServer?.close();
    this.logger.info("ACP server stopped");
  }

  private async handleMessage(message: JsonRpcMessage, ws: WebSocket): Promise<void> {
    if (!("method" in message)) return;

    const { id, method, params } = message as {
      jsonrpc: typeof JSONRPC_VERSION;
      id: JsonRpcId;
      method: string;
      params: unknown;
    };

    try {
      await this.handler(
        { jsonrpc: "2.0", id, method, params },
        ws
      );
    } catch (error) {
      this.sendError(ws, id, -32000, error instanceof Error ? error.message : String(error));
    }
  }

  sendResponse(ws: WebSocket, id: JsonRpcId, result: unknown): void {
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  sendError(ws: WebSocket, id: JsonRpcId | null, code: number, message: string): void {
    ws.send(JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code, message }
    }));
  }

  sendNotification(ws: WebSocket, method: string, params: unknown): void {
    ws.send(JSON.stringify({
      jsonrpc: "2.0",
      method,
      params
    }));
  }

  /**
   * Associate a WebSocket connection with a session for targeted notifications.
   */
  registerSessionConnection(sessionId: string, ws: WebSocket): void {
    if (!this.sessionConnections.has(sessionId)) {
      this.sessionConnections.set(sessionId, new Set());
    }
    this.sessionConnections.get(sessionId)!.add(ws);
  }

  /**
   * Remove a WebSocket from all session connections on disconnect.
   */
  private cleanupSessionConnections(ws: WebSocket): void {
    for (const [sessionId, connections] of this.sessionConnections) {
      connections.delete(ws);
      if (connections.size === 0) {
        this.sessionConnections.delete(sessionId);
      }
    }
  }

  /**
   * Send a notification to all WebSocket connections for a specific session.
   */
  sendNotificationToSession(sessionId: string, method: string, params: unknown): void {
    const connections = this.sessionConnections.get(sessionId);
    if (!connections) return;

    for (const ws of connections) {
      if (ws.readyState === WebSocket.OPEN) {
        this.sendNotification(ws, method, params);
      }
    }
  }

  /**
   * Unregister a session's WebSocket connection.
   */
  unregisterSession(sessionId: string, ws: WebSocket): void {
    const connections = this.sessionConnections.get(sessionId);
    if (connections) {
      connections.delete(ws);
      if (connections.size === 0) {
        this.sessionConnections.delete(sessionId);
      }
    }
  }
}