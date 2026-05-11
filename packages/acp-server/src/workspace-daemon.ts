import type {
  AcpSession,
  AcpSessionConfig,
  AcpWorkspace,
  WorkDefinition,
  WorkTaskStatus,
  JsonRpcId,
  JSONRPC_VERSION,
  IdeToDaemonMethods,
  DaemonToIdeNotifications,
} from "@paperclipai/acp-types";
import type { ServerAdapterModule, AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import { EventEmitter } from "node:events";
import pino from "pino";

import { FileWatcher, type FileWatcherOptions } from "./file-watcher.js";
import { WorkDefinitionStore } from "./work-definition-store.js";
import { AcpServer, type RpcHandler } from "./server.js";

// ---------------------------------------------------------------------------
// WorkspaceDaemon - Core ACP server with IDE-native agent engine
// ---------------------------------------------------------------------------

export interface WorkspaceDaemonConfig {
  port?: number;
  host?: string;
  workspacePath: string;
  additionalDirectories?: string[];
  adapter?: ServerAdapterModule;
  companyId?: string;
  fileWatcherOptions?: Omit<FileWatcherOptions, "workspacePath" | "workspacePaths">;
}

/**
 * Transcript entry for storing agent output.
 */
export interface TranscriptEntry {
  sessionId: string;
  type: "stdout" | "stderr";
  data: string;
  timestamp: string;
}

/**
 * Active agent execution session with WebSocket tracking for notifications.
 */
interface ActiveExecutionSession {
  sessionId: string;
  ws: import("ws").WebSocket;
}

export class WorkspaceDaemon extends EventEmitter {
  private sessions = new Map<string, AcpSession>();
  private transcriptEntries = new Map<string, TranscriptEntry[]>();
  private server: AcpServer;
  private logger: pino.Logger;
  private fileWatcher: FileWatcher;
  private workStore: WorkDefinitionStore;
  private activeExecutions = new Map<string, ActiveExecutionSession>();

  constructor(private config: WorkspaceDaemonConfig) {
    super();
    this.logger = pino({ name: "workspace-daemon" });

    const workspacePaths = [
      config.workspacePath,
      ...(config.additionalDirectories ?? []),
    ];

    this.fileWatcher = new FileWatcher({
      workspacePaths,
      ...config.fileWatcherOptions,
    });

    this.workStore = new WorkDefinitionStore({
      workspacePath: config.workspacePath,
      companyId: config.companyId,
    });

    this.server = new AcpServer(
      { port: config.port, host: config.host },
      this.handleRpcMessage.bind(this)
    );

    this.setupFileWatcher();
  }

  async start(): Promise<void> {
    await this.workStore.initialize();
    this.fileWatcher.start();
    await this.server.start();
    this.logger.info("Workspace daemon started");
  }

  async stop(): Promise<void> {
    this.fileWatcher.stop();
    await this.server.stop();
    this.logger.info("Workspace daemon stopped");
  }

  getPort(): number | null {
    return this.config.port ?? null;
  }

  private setupFileWatcher(): void {
    this.fileWatcher.on("change", (event: { path: string; type: string }) => {
      this.emit("fileChange", event);
      // Send file change notification to sessions with matching workspace
      for (const session of this.sessions.values()) {
        if (session.workspaceId && event.path.includes(session.workspaceId)) {
          this.server.sendNotificationToSession(
            session.id,
            "file.change",
            {
              path: event.path,
              type: event.type,
            } as DaemonToIdeNotifications["file.change"]
          );
        }
      }
    });
  }

// -----------------------------------------------------------------------
  // RPC Message Handler
  // -----------------------------------------------------------------------

  private handleRpcMessage: RpcHandler = async (message, ws, _sessionId) => {
    const { method, id } = message;

    switch (method) {
      case "session.initialize": {
        const session = await this.initializeSession(message.params as AcpSessionConfig, ws);
        this.server.sendResponse(ws, id, session);
        break;
      }
      case "session.close": {
        const result = await this.closeSession(message.params as { sessionId: string });
        this.server.sendResponse(ws, id, result);
        break;
      }
      case "session.status": {
        const session = await this.getSessionStatus(message.params as { sessionId: string });
        this.server.sendResponse(ws, id, session);
        break;
      }
      case "task.create": {
        const task = await this.createTask(
          message.params as Omit<WorkDefinition, "id" | "metadata" | "status"> & { workspaceId: string }
        );
        this.server.sendResponse(ws, id, task);
        break;
      }
      case "task.list": {
        const tasks = await this.listTasks(
          message.params as { workspaceId: string; status?: WorkDefinition["status"] }
        );
        this.server.sendResponse(ws, id, tasks);
        break;
      }
      case "task.get": {
        const task = await this.getTask(message.params as { taskId: string });
        this.server.sendResponse(ws, id, task);
        break;
      }
      case "task.update": {
        const task = await this.updateTask(message.params as { taskId: string; patch: Partial<WorkDefinition> });
        this.server.sendResponse(ws, id, task);
        break;
      }
      case "agent.execute": {
        const result = await this.executeAgent(
          message.params as { sessionId: string; prompt: string; workSpec?: WorkDefinition["workSpec"] },
          ws
        );
        this.server.sendResponse(ws, id, result);
        break;
      }
      case "agent.runInIde": {
        const result = await this.runAgentInIde(
          message.params as { sessionId: string; prompt: string; workSpec?: WorkDefinition["workSpec"] },
          ws
        );
        this.server.sendResponse(ws, id, result);
        break;
      }
      case "ide.executeResult": {
        await this.handleIdeExecuteResult(
          message.params as {
            taskId: string;
            result: {
              exitCode: number;
              stdout?: string;
              stderr?: string;
              summary?: string;
              errorMessage?: string;
            };
          }
        );
        this.server.sendResponse(ws, id, { success: true });
        break;
      }
      case "workspace.get": {
        const workspace = await this.getWorkspace(
          message.params as { workspaceId: string }
        );
        this.server.sendResponse(ws, id, workspace);
        break;
      }
      case "workspace.list": {
        const workspaces = await this.listWorkspaces();
        this.server.sendResponse(ws, id, workspaces);
        break;
      }
      default:
        this.server.sendError(ws, id, -32601, `Method not found: ${method}`);
    }
  };

  // -----------------------------------------------------------------------
  // Session Handlers
  // -----------------------------------------------------------------------

  private async initializeSession(config: AcpSessionConfig, ws: import("ws").WebSocket): Promise<AcpSession> {
    const session: AcpSession = {
      id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      agentId: config.agentId,
      workspaceId: config.workspaceId,
      status: "active",
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      additionalDirectories: config.additionalDirectories,
    };
    this.sessions.set(session.id, session);
    this.server.registerSessionConnection(session.id, ws);
    this.emit("sessionInitialized", session);
    return session;
  }

  private async closeSession(params: { sessionId: string }): Promise<{ closed: boolean }> {
    const session = this.sessions.get(params.sessionId);
    if (session) {
      session.status = "closed";
      this.server.sendNotificationToSession(
        params.sessionId,
        "session.statusChanged",
        {
          sessionId: params.sessionId,
          status: "closed",
        } as DaemonToIdeNotifications["session.statusChanged"]
      );
      this.sessions.delete(params.sessionId);
      this.emit("sessionClosed", session);
      return { closed: true };
    }
    return { closed: false };
  }

  private async getSessionStatus(params: { sessionId: string }): Promise<AcpSession> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }
    return session;
  }

  // -----------------------------------------------------------------------
  // Workspace Handlers
  // -----------------------------------------------------------------------

  private async getWorkspace(params: { workspaceId: string }): Promise<AcpWorkspace | null> {
    const workspace = this.buildWorkspace();
    if (workspace.id === params.workspaceId) {
      return workspace;
    }
    return null;
  }

  private async listWorkspaces(): Promise<AcpWorkspace[]> {
    return [this.buildWorkspace()];
  }

  private buildWorkspace(): AcpWorkspace {
    return {
      id: this.config.workspacePath,
      path: this.config.workspacePath,
      companyId: this.config.companyId,
      status: "active",
      createdAt: new Date().toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // Task Handlers
  // -----------------------------------------------------------------------

  private async createTask(
    params: Omit<WorkDefinition, "id" | "metadata" | "status">
  ): Promise<WorkDefinition> {
    return this.workStore.createTask(params);
  }

  private async getTask(params: { taskId: string }): Promise<WorkDefinition | null> {
    return this.workStore.getTask(params.taskId);
  }

  private async listTasks(params: { workspaceId?: string; status?: WorkDefinition["status"] }): Promise<WorkDefinition[]> {
    return this.workStore.listTasks(params.status, params.workspaceId);
  }

  private async updateTask(params: { taskId: string; patch: Partial<WorkDefinition> }): Promise<WorkDefinition | null> {
    const updated = await this.workStore.updateTask(params.taskId, params.patch);
    if (updated && params.patch.status) {
      // Send status change notification to all sessions
      for (const session of this.sessions.values()) {
        this.server.sendNotificationToSession(
          session.id,
          "task.statusChanged",
          {
            taskId: updated.id,
            status: updated.status,
          } as DaemonToIdeNotifications["task.statusChanged"]
        );
      }
    }
    return updated;
  }

  // -----------------------------------------------------------------------
  // Agent Execution Handler
  // -----------------------------------------------------------------------

  private async executeAgent(
    params: {
      sessionId: string;
      prompt: string;
      workSpec?: WorkDefinition["workSpec"];
    },
    ws: import("ws").WebSocket
  ): Promise<{ runId: string }> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.emit("agentExecute", { sessionId: params.sessionId, prompt: params.prompt, runId });

    if (!this.config.adapter?.type) {
      this.logger.error({ sessionId: params.sessionId, runId }, "No adapter configured for agent execution");
      throw new Error("No adapter configured for agent execution");
    }

    this.logger.info({ sessionId: params.sessionId, runId, adapter: this.config.adapter.type }, "Executing agent");

    this.activeExecutions.set(runId, { sessionId: params.sessionId, ws });

    try {
      const ctx: AdapterExecutionContext = {
        runId,
        agent: {
          id: session.agentId,
          companyId: this.config.companyId || "default",
          name: session.agentId,
          adapterType: this.config.adapter.type,
          adapterConfig: {},
        },
        runtime: {
          sessionId: session.id,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {},
        context: { prompt: params.prompt, workSpec: params.workSpec },
        onLog: async (stream: "stdout" | "stderr", chunk: string) => {
          this.streamOutput(params.sessionId, stream, chunk);
        },
      };

      const result = await this.config.adapter.execute(ctx);

      this.server.sendNotificationToSession(
        params.sessionId,
        "agent.output",
        {
          sessionId: params.sessionId,
          type: "result",
          data: result.errorMessage || result.summary || "Execution completed",
        } as DaemonToIdeNotifications["agent.output"]
      );

      return { runId };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error({ sessionId: params.sessionId, runId, error: errorMsg }, "Agent execution failed");

      this.server.sendNotificationToSession(
        params.sessionId,
        "agent.error",
        {
          sessionId: params.sessionId,
          error: {
            code: -32000,
            message: errorMsg,
          },
        } as DaemonToIdeNotifications["agent.error"]
      );

      throw error;
} finally {
       this.activeExecutions.delete(runId);
     }
   }

  // -----------------------------------------------------------------------
  // IDE Execution Mode
  // -----------------------------------------------------------------------

  /**
   * Run a task in the connected IDE instead of server-side adapter.
   * Sends a task.executeRequest notification to the IDE for it to execute.
   */
  private async runAgentInIde(
    params: {
      sessionId: string;
      prompt: string;
      workSpec?: WorkDefinition["workSpec"];
    },
    ws: import("ws").WebSocket
  ): Promise<{ taskId: string }> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${params.sessionId}`);
    }

    // Create a task for IDE execution
    const task = await this.workStore.createTask({
      type: "execute",
      priority: "medium",
      dependencies: [],
      workSpec: params.workSpec ?? { prompt: params.prompt },
      assignedTo: session.agentId,
    });

    // Send execution request to the IDE
    this.server.sendNotificationToSession(
      params.sessionId,
      "task.executeRequest",
      {
        taskId: task.id,
        workSpec: task.workSpec,
      } as DaemonToIdeNotifications["task.executeRequest"]
    );

    this.logger.info({ sessionId: params.sessionId, taskId: task.id }, "Sent task execute request to IDE");

    return { taskId: task.id };
  }

  /**
   * Handle execution result from the IDE.
   */
  private async handleIdeExecuteResult(params: {
    taskId: string;
    result: {
      exitCode: number;
      stdout?: string;
      stderr?: string;
      summary?: string;
      errorMessage?: string;
    };
  }): Promise<void> {
    const task = await this.workStore.getTask(params.taskId);
    if (!task) {
      this.logger.warn({ taskId: params.taskId }, "Task not found for IDE execute result");
      return;
    }

    // Update task with result
    const status: WorkTaskStatus = params.result.exitCode === 0 ? "completed" : "failed";
    const updated = await this.workStore.updateTask(params.taskId, {
      status,
      result: {
        exitCode: params.result.exitCode,
        stdout: params.result.stdout,
        stderr: params.result.stderr,
        artifacts: [],
        cost: {
          inputTokens: 0,
          outputTokens: 0,
          costCents: 0,
        },
      },
    });

    if (updated) {
      // Stream output to all sessions in the same workspace
      for (const session of this.sessions.values()) {
        if (task.workSpec?.cwd && session.workspaceId) {
          this.server.sendNotificationToSession(
            session.id,
            "agent.output",
            {
              sessionId: session.id,
              type: "result",
              data: params.result.summary || params.result.errorMessage || `Task ${status}`,
            } as DaemonToIdeNotifications["agent.output"]
          );
        }
      }
    }

    this.logger.info({ taskId: params.taskId, status }, "IDE execute result processed");
  }

  /**
   * Stream output from adapter execution to the connected IDE client.
    */
  private streamOutput(sessionId: string, type: "stdout" | "stderr", data: string): void {
    const entry: TranscriptEntry = {
      sessionId,
      type,
      data,
      timestamp: new Date().toISOString(),
    };
    
    const entries = this.transcriptEntries.get(sessionId) ?? [];
    entries.push(entry);
    this.transcriptEntries.set(sessionId, entries);
    
    this.server.sendNotificationToSession(
      sessionId,
      "agent.output",
      {
        sessionId,
        type,
        data,
      } as DaemonToIdeNotifications["agent.output"]
    );
  }

  // -----------------------------------------------------------------------
  // Public API for Session Data Access
  // -----------------------------------------------------------------------

  /**
   * Get all active sessions.
   */
  getSessions(): AcpSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get a single session by ID.
   */
  getSession(sessionId: string): AcpSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get transcript entries for a session.
   */
  getTranscriptEntries(sessionId: string): TranscriptEntry[] {
    return this.transcriptEntries.get(sessionId) ?? [];
  }

  // -----------------------------------------------------------------------
  // Public API for Work Definition Access
  // -----------------------------------------------------------------------

  /**
   * Get all work definitions, optionally filtered by status and workspace.
   */
  async getWorkDefinitions(
    status?: WorkDefinition["status"],
    workspaceId?: string
  ): Promise<WorkDefinition[]> {
    return this.workStore.listTasks(status, workspaceId);
  }

  /**
   * Get a single work definition by ID.
   */
  async getWorkDefinition(taskId: string): Promise<WorkDefinition | null> {
    return this.workStore.getTask(taskId);
  }
}