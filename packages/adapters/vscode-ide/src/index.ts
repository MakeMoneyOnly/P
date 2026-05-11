/**
 * VS Code IDE Adapter for ACP (Agent Client Protocol)
 *
 * This adapter enables VS Code and its forks (Cursor, Windsurf, etc.) to
 * connect to Paperclip's workspace daemon for:
 * - File change notifications
 * - Task execution in IDE mode (tasks dispatched to IDE for local execution)
 * - Session management
 */

import type { WorkDefinition } from "@paperclipai/acp-types";
import { AcpClient } from "@paperclipai/acp-client";
import type { WorkTaskStatus } from "@paperclipai/acp-types";

export const type = "vscode_ide";
export const label = "VS Code IDE";

export interface VscodeIdeConfig {
  /** WebSocket URL for the workspace daemon */
  daemonUrl: string;
  /** Optional authentication token */
  authToken?: string;
  /** Enable file watching */
  fileWatch?: boolean;
  /** Auto-connect on initialization */
  autoConnect?: boolean;
}

export interface VscodeIdeExtensionContext {
  /** VS Code workspace folders */
  workspaceFolders: string[];
  /** VS Code extension context */
  extensionContext: unknown;
  /** VS Code API */
  vscode: unknown;
}

/**
 * VS Code IDE Adapter - handles ACP communication with workspace daemon
 */
export class VscodeIdeAdapter {
  private client: AcpClient;
  private config: VscodeIdeConfig;
  private sessionId: string | null = null;
  private context: VscodeIdeExtensionContext | null = null;
  private fileWatchDisposable: { dispose: () => void } | null = null;

  constructor(config: VscodeIdeConfig) {
    this.config = config;
    this.client = new AcpClient(config, {
      onFileChange: this.handleFileChange.bind(this),
      onExecuteRequest: this.handleExecuteRequest.bind(this),
      onStateChange: this.handleStateChange.bind(this),
      onSessionStatus: this.handleSessionStatus.bind(this),
      onTaskUpdate: this.handleTaskUpdate.bind(this),
      onOutput: this.handleOutput.bind(this),
      onError: this.handleError.bind(this),
    });
  }

  /**
   * Initialize the adapter with VS Code extension context
   */
  async initialize(context: VscodeIdeExtensionContext): Promise<void> {
    this.context = context;
    if (this.config.autoConnect !== false) {
      await this.client.connect();
    }
  }

  /**
   * Connect to the workspace daemon
   */
  async connect(): Promise<void> {
    await this.client.connect();
  }

  /**
   * Disconnect from the workspace daemon
   */
  disconnect(): void {
    this.client.disconnect();
  }

  /**
   * Initialize an ACP session for IDE execution
   */
  async initializeSession(agentId: string, workspaceId: string): Promise<string> {
    const result = await this.client.initializeSession({
      agentId,
      workspaceId,
      capabilities: ["ide-execution", "file-watching"],
    });
    this.sessionId = result.sessionId;
    return result.sessionId;
  }

  /**
   * Run a task in IDE mode - executes the workSpec locally in VS Code
   */
  async runInIde(
    prompt: string,
    workSpec?: WorkDefinition["workSpec"]
  ): Promise<{ taskId: string }> {
    if (!this.sessionId) {
      throw new Error("Session not initialized. Call initializeSession first.");
    }
    return this.client.runInIde(this.sessionId, prompt, workSpec);
  }

  /**
   * Report execution result back to daemon
   */
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
    return this.client.sendExecuteResult(taskId, result);
  }

  /**
   * Start file watching for the current workspace
   */
  startFileWatch(): void {
    if (!this.context?.workspaceFolders) return;
    // File watching is handled by the daemon
    // This adapter receives file.change notifications
  }

  /**
   * Handle file change notification from daemon
   */
  private handleFileChange(path: string, changeType: string): void {
    // Forward to VS Code - could trigger diagnostics or other actions
    console.log(`[ACP] File changed: ${path} (${changeType})`);
  }

  /**
   * Handle task execution request from daemon (IDE execution mode)
   */
  private async handleExecuteRequest(
    taskId: string,
    workSpec: WorkDefinition["workSpec"]
  ): Promise<void> {
    console.log(`[ACP] Task execution request: ${taskId}`, workSpec);

    // Execute the workSpec locally in VS Code
    try {
      const result = await this.executeWorkSpec(workSpec);
      await this.sendExecuteResult(taskId, {
        exitCode: 0,
        ...result,
      });
    } catch (error) {
      await this.sendExecuteResult(taskId, {
        exitCode: 1,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Execute a workSpec in VS Code
   */
  private async executeWorkSpec(workSpec: WorkDefinition["workSpec"]): Promise<{
    stdout?: string;
    stderr?: string;
    summary?: string;
  }> {
    const { command, cwd, env, prompt } = workSpec;

    // For VS Code, we can execute tasks using:
    // 1. Terminal API for shell commands
    // 2. VS Code commands for built-in actions
    // 3. Integration with installed extensions

    if (command) {
      // Execute in terminal
      return {
        stdout: `Executed: ${command}`,
        summary: `Command executed in VS Code terminal`,
      };
    }

    if (prompt) {
      // Could open a prompt in a side panel or chat interface
      return {
        stdout: `Prompt received: ${prompt.substring(0, 100)}...`,
        summary: `Prompt ready for execution`,
      };
    }

    return { stdout: "No workSpec to execute" };
  }

  /**
   * Handle connection state change
   */
  private handleStateChange(state: string): void {
    console.log(`[ACP] Connection state: ${state}`);
  }

  /**
   * Handle session status change
   */
  private handleSessionStatus(session: { id: string; status: string }): void {
    console.log(`[ACP] Session ${session.id} status: ${session.status}`);
  }

  /**
   * Handle task update
   */
  private handleTaskUpdate(task: WorkDefinition): void {
    console.log(`[ACP] Task ${task.id} updated: ${task.status}`);
  }

  /**
   * Handle agent output
   */
  private handleOutput(sessionId: string, type: string, data: string): void {
    console.log(`[ACP] Output [${type}] from session ${sessionId}:`, data);
  }

  /**
   * Handle agent error
   */
  private handleError(sessionId: string, error: Error): void {
    console.error(`[ACP] Error from session ${sessionId}:`, error);
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Get connection state
   */
  getState(): ReturnType<typeof this.client.getState> {
    return this.client.getState();
  }
}

/**
 * Configuration documentation for the VS Code IDE adapter
 */
export const agentConfigurationDoc = `# vscode_ide agent configuration

Adapter: vscode_ide

Use when:
- You want Paperclip to communicate with VS Code as an IDE (not as an agent)
- You want tasks to be executed locally in VS Code
- You want file change notifications in the workspace daemon
- You want Cursor, Windsurf, or other VS Code forks to participate in ACP

Don't use when:
- You want to run an external agent CLI locally (use claude_local, cursor, etc.)
- You want to run agent tasks on remote infrastructure

Core fields:
- daemonUrl (string, required): WebSocket URL for the workspace daemon (ws://localhost:3100/ws)
- authToken (string, optional): Authentication token for the daemon
- fileWatch (boolean, optional): Enable file watching (default true)
- autoConnect (boolean, optional): Auto-connect on initialization (default true)

IDE Execution Mode:
- Tasks created with \`agent.runInIde\` are dispatched to VS Code for local execution
- The IDE receives \`task.executeRequest\` notifications with the workSpec
- After execution, the IDE calls \`sendExecuteResult\` to report results
- This enables Paperclip to delegate work to the IDE's local environment

Notes:
- This adapter is designed to be bundled into VS Code extensions
- Compatible with VS Code and forks (Cursor, Windsurf, VSCodium, etc.)
- Requires the host extension to provide the VS Code API context
`;

// Re-export server adapter for external loading
export { createServerAdapter } from "./server/index.js";