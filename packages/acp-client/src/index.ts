import type {
  AcpSession,
  AcpSessionConfig,
  WorkDefinition,
  WorkTaskStatus,
  IdeToDaemonMethods,
  DaemonToIdeNotifications,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcId,
} from "@paperclipai/acp-types";
import { JSONRPC_VERSION } from "@paperclipai/acp-types";

// ---------------------------------------------------------------------------
// ACP Client - IDE-side library for connecting to workspace daemon
// ---------------------------------------------------------------------------

/**
 * Configuration for the ACP client.
 */
export interface AcpClientConfig {
  /** WebSocket URL for the workspace daemon */
  daemonUrl: string;
  /** Optional authentication token */
  authToken?: string;
  /** Reconnection settings */
  reconnect?: {
    enabled?: boolean;
    maxAttempts?: number;
    delayMs?: number;
  };
}

/**
 * WebSocket connection state.
 */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

/**
 * Event handlers for the ACP client.
 */
export interface AcpClientEvents {
  /** Connection state changed */
  onStateChange?: (state: ConnectionState) => void;
  /** Session status changed */
  onSessionStatus?: (session: AcpSession) => void;
  /** Task status changed */
  onTaskUpdate?: (task: WorkDefinition) => void;
  /** Agent output received */
  onOutput?: (sessionId: string, type: string, data: string) => void;
  /** Agent error */
  onError?: (sessionId: string, error: Error) => void;
  /** Notification from daemon */
  onNotification?: (method: string, params: unknown) => void;
  /** File change notification */
  onFileChange?: (path: string, type: string) => void;
  /** Task execution request from daemon (IDE execution mode) */
  onExecuteRequest?: (taskId: string, workSpec: WorkDefinition["workSpec"]) => void;
}

/**
 * Pending request with resolver.
 */
interface PendingRequest<T = unknown> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * ACP Client - connects IDE to workspace daemon via WebSocket/JSON-RPC 2.0
 */
export class AcpClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private pendingRequests = new Map<number, PendingRequest>();
  private nextId = 1;
  private reconnectAttempts = 0;
  private messageQueue: string[] = [];
  private eventHandlers: AcpClientEvents;

  constructor(
    private config: AcpClientConfig,
    eventHandlers: AcpClientEvents = {}
  ) {
    this.eventHandlers = eventHandlers;
  }

  /** Current connection state */
  getState(): ConnectionState {
    return this.state;
  }

  /** Connect to the workspace daemon */
  async connect(): Promise<void> {
    if (this.ws && this.state === "connected") {
      return;
    }

    this.setState("connecting");

    return new Promise((resolve, reject) => {
      try {
        const wsUrl = this.config.daemonUrl.replace(/^http/, "ws");
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.setState("connected");
          this.reconnectAttempts = 0;
          this.flushMessageQueue();
          resolve();
        };

        this.ws.onclose = () => {
          this.setState("disconnected");
          this.ws = null;
          this.handleReconnect();
        };

        this.ws.onerror = () => {
          this.setState("error");
        };

        this.ws.onmessage = (event: MessageEvent) => {
          this.handleMessage(event.data);
        };
      } catch (error) {
        this.setState("error");
        reject(error);
      }
    });
  }

  /** Disconnect from the workspace daemon */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState("disconnected");
    this.pendingRequests.forEach((req) => {
      clearTimeout(req.timeout);
      req.reject(new Error("Disconnected"));
    });
    this.pendingRequests.clear();
  }

  /** Initialize a session */
  async initializeSession(config: AcpSessionConfig): Promise<{ sessionId: string; agent: import("@paperclipai/acp-types").AcpAgent }> {
    return this.request("session.initialize", config);
  }

  /** Close a session */
  async closeSession(sessionId: string): Promise<{ closed: boolean }> {
    return this.request("session.close", { sessionId });
  }

  /** Get session status */
  async getSessionStatus(sessionId: string): Promise<AcpSession> {
    return this.request("session.status", { sessionId });
  }

  /** Create a task */
  async createTask(
    params: Omit<WorkDefinition, "id" | "metadata" | "status"> & {
      workspaceId: string;
    }
  ): Promise<WorkDefinition> {
    return this.request("task.create", params);
  }

  /** List tasks */
  async listTasks(workspaceId: string, status?: WorkTaskStatus): Promise<WorkDefinition[]> {
    return this.request("task.list", { workspaceId, status });
  }

  /** Get a task */
  async getTask(taskId: string): Promise<WorkDefinition | null> {
    return this.request("task.get", { taskId });
  }

  /** Update a task */
  async updateTask(
    taskId: string,
    patch: Partial<WorkDefinition>
  ): Promise<WorkDefinition> {
    return this.request("task.update", { taskId, patch });
  }

  /** Execute agent */
  async execute(
    sessionId: string,
    prompt: string,
    workSpec?: WorkDefinition["workSpec"]
  ): Promise<{ runId: string }> {
    return this.request("agent.execute", { sessionId, prompt, workSpec });
  }

  /** Run agent in IDE mode (sends request to IDE for local execution) */
  async runInIde(
    sessionId: string,
    prompt: string,
    workSpec?: WorkDefinition["workSpec"]
  ): Promise<{ taskId: string }> {
    return this.request("agent.runInIde", { sessionId, prompt, workSpec });
  }

  /** Send execution result back to daemon after IDE completes work */
  async sendExecuteResult(
    taskId: string,
    result: {
      exitCode: number;
      stdout?: string;
      stderr?: string;
      summary?: string;
      errorMessage?: string;
    }
  ): Promise<{ success: boolean }> {
    return this.request("ide.executeResult", { taskId, result });
  }

  /** Handle incoming message */
  private handleMessage(data: string | Blob): void {
    if (typeof data === "string") {
      this.handleMessageString(data);
    } else {
      data.text().then((text) => this.handleMessageString(text));
    }
  }

  private handleMessageString(data: string): void {
    try {
      const message = JSON.parse(data) as JsonRpcResponse | JsonRpcNotification;

      if (message.id !== null && "result" in message && this.pendingRequests.has(message.id as number)) {
        const pending = this.pendingRequests.get(message.id as number)!;
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id as number);
        if ("error" in message && message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve((message as JsonRpcResponse).result);
        }
      } else if ("method" in message) {
        this.handleNotification(message as JsonRpcNotification);
      }
    } catch (error) {
      console.error("Failed to handle ACP message:", error);
    }
  }

  /** Handle notification from daemon */
  private handleNotification(notification: JsonRpcNotification): void {
    const { method, params } = notification;

    switch (method) {
      case "session.statusChanged": {
        const p = params as DaemonToIdeNotifications["session.statusChanged"];
        this.eventHandlers.onSessionStatus?.({
          id: p.sessionId,
          agentId: "",
          workspaceId: "",
          status: p.status,
          createdAt: new Date().toISOString(),
          lastActivityAt: new Date().toISOString(),
        });
        break;
      }
      case "task.statusChanged": {
        const p = params as DaemonToIdeNotifications["task.statusChanged"];
        this.eventHandlers.onTaskUpdate?.({
          id: p.taskId,
          type: "execute",
          status: p.status,
          priority: "medium",
          dependencies: [],
          workSpec: {},
          metadata: {
            createdAt: new Date().toISOString(),
            createdBy: "",
            updatedAt: new Date().toISOString(),
            iteration: 0,
          },
        });
        break;
      }
      case "agent.output": {
        const p = params as DaemonToIdeNotifications["agent.output"];
        this.eventHandlers.onOutput?.(p.sessionId, p.type, p.data);
        break;
      }
      case "agent.error": {
        const p = params as DaemonToIdeNotifications["agent.error"];
        this.eventHandlers.onError?.(p.sessionId, new Error(p.error.message));
        break;
      }
      case "file.change": {
        const p = params as { path: string; type: string };
        this.eventHandlers.onFileChange?.(p.path, p.type);
        break;
      }
      case "task.executeRequest": {
        const p = params as DaemonToIdeNotifications["task.executeRequest"];
        this.eventHandlers.onExecuteRequest?.(p.taskId, p.workSpec);
        break;
      }
    }

    this.eventHandlers.onNotification?.(method, params);
  }

  /** Send a request and wait for response */
  private request<M extends keyof IdeToDaemonMethods>(
    method: M,
    params: IdeToDaemonMethods[M][0]
  ): Promise<IdeToDaemonMethods[M][1]> {
    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: JSONRPC_VERSION,
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const pending: PendingRequest<IdeToDaemonMethods[M][1]> = {
        resolve: resolve as (value: IdeToDaemonMethods[M][1]) => void,
        reject,
        timeout: setTimeout(() => {
          this.pendingRequests.delete(id);
          reject(new Error(`ACP request timeout: ${String(method)}`));
        }, 30000),
      };
      this.pendingRequests.set(id, pending as PendingRequest<unknown>);
      this.sendMessage(request);
    });
  }

  /** Send a message over WebSocket */
  private sendMessage(message: JsonRpcRequest): void {
    const data = JSON.stringify(message);
    if (this.ws && this.state === "connected") {
      this.ws.send(data);
    } else {
      this.messageQueue.push(data);
    }
  }

  /** Flush queued messages */
  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.ws && this.state === "connected") {
      this.ws.send(this.messageQueue.shift()!);
    }
  }

  /** Update connection state */
  private setState(state: ConnectionState): void {
    this.state = state;
    this.eventHandlers.onStateChange?.(state);
  }

  /** Handle reconnection */
  private handleReconnect(): void {
    if (this.config.reconnect?.enabled !== false) {
      const maxAttempts = this.config.reconnect?.maxAttempts ?? 5;
      if (this.reconnectAttempts < maxAttempts) {
        this.reconnectAttempts++;
        this.setState("reconnecting");
        setTimeout(() => this.connect(), this.config.reconnect?.delayMs ?? 1000);
      }
    }
  }
}