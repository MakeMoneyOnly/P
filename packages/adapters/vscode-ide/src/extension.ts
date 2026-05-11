/**
 * VS Code Extension Integration for ACP
 *
 * This module provides the VS Code extension side of ACP integration.
 * It should be bundled into VS Code extensions that want to participate
 * in the ACP protocol.
 *
 * Usage in a VS Code extension:
 * ```typescript
 * import { activateAcpExtension } from '@paperclipai/adapter-vscode-ide/extension';
 *
 * export function activate(context: vscode.ExtensionContext) {
 *   const manager = activateAcpExtension(context);
 *   // The manager handles ACP communication automatically
 * }
 * ```
 */

import { AcpClient } from "@paperclipai/acp-client";
import type { WorkDefinition } from "@paperclipai/acp-types";

// Minimal VS Code types (provided by peer dependency 'vscode')
type VscodeExtensionContext = {
  subscriptions: Array<{ dispose: () => void }>;
};

/**
 * Extension configuration for ACP
 */
export interface AcpExtensionConfig {
  /** Workspace daemon URL (default: ws://localhost:3100/ws) */
  daemonUrl?: string;
  /** Authentication token */
  authToken?: string;
}

/**
 * Output channel interface for logging
 */
interface OutputChannel {
  appendLine(msg: string): void;
  clear(): void;
  show(preserveFocus?: boolean): void;
  dispose(): void;
}

/**
 * VS Code Extension ACP Manager - handles ACP communication
 */
export class AcpExtensionManager {
  private client: AcpClient;
  private sessionId: string | null = null;
  private outputChannel: OutputChannel;

  constructor(config: AcpExtensionConfig = {}) {
    // Console-based output channel for standalone use
    this.outputChannel = {
      appendLine: (msg: string) => console.log(`[Paperclip ACP] ${msg}`),
      clear: () => {},
      show: () => {},
      dispose: () => {},
    };

    this.client = new AcpClient(
      {
        daemonUrl: config.daemonUrl || "ws://localhost:3100/ws",
        authToken: config.authToken,
      },
      {
        onStateChange: (state) => this.outputChannel.appendLine(`Connection state: ${state}`),
        onFileChange: (path, type) => this.outputChannel.appendLine(`File ${type}: ${path}`),
        onExecuteRequest: (taskId, workSpec) => this.handleExecuteRequest(taskId, workSpec),
        onSessionStatus: (session) => this.outputChannel.appendLine(`Session ${session.id}: ${session.status}`),
        onTaskUpdate: (task) => this.outputChannel.appendLine(`Task ${task.id}: ${task.status}`),
        onOutput: (sessionId, type, data) => this.outputChannel.appendLine(`${type}: ${data}`),
        onError: (sessionId, error) => this.outputChannel.appendLine(`Error: ${error.message}`),
      }
    );
  }

  /**
   * Activate the ACP extension
   */
  async activate(): Promise<void> {
    try {
      await this.client.connect();
      this.outputChannel.appendLine("Connected to workspace daemon");
    } catch (error) {
      this.outputChannel.appendLine(`Connection failed: ${error}`);
    }
  }

  /**
   * Deactivate the ACP extension
   */
  deactivate(): void {
    this.client.disconnect();
    this.outputChannel.dispose();
  }

  /**
   * Initialize an ACP session
   */
  async initializeSession(workspaceId?: string): Promise<string> {
    const wsId = workspaceId || "vscode-workspace";
    const result = await this.client.initializeSession({
      agentId: "vscode-ide",
      workspaceId: wsId,
      capabilities: ["ide-execution", "file-watching", "terminal-access"],
    });
    this.sessionId = result.sessionId;
    return result.sessionId;
  }

  /**
   * Handle task execution request from daemon (IDE execution mode)
   */
  private async handleExecuteRequest(taskId: string, workSpec: WorkDefinition["workSpec"]): Promise<void> {
    this.outputChannel.appendLine(`Executing task ${taskId}`);

    try {
      const result = await this.executeInWorkspace(workSpec);
      await this.client.sendExecuteResult(taskId, {
        exitCode: 0,
        ...result,
      });
      this.outputChannel.appendLine(`Task ${taskId} completed`);
    } catch (error) {
      await this.client.sendExecuteResult(taskId, {
        exitCode: 1,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      this.outputChannel.appendLine(`Task ${taskId} failed: ${error}`);
    }
  }

  /**
   * Execute workSpec in the VS Code workspace
   */
  private async executeInWorkspace(workSpec: WorkDefinition["workSpec"]): Promise<{
    stdout?: string;
    stderr?: string;
    summary?: string;
  }> {
    const { command, cwd, prompt } = workSpec;

    if (command) {
      this.outputChannel.appendLine(`Would execute: ${command}${cwd ? ` (cwd: ${cwd})` : ""}`);
      return {
        stdout: `Command: ${command}`,
        summary: `Command would be executed in VS Code terminal`,
      };
    }

    if (prompt) {
      this.outputChannel.clear();
      this.outputChannel.appendLine("=== Paperclip ACP Task ===");
      this.outputChannel.appendLine(prompt);
      return {
        stdout: `Prompt received (${prompt.length} chars)`,
        summary: `Prompt displayed in Paperclip output channel`,
      };
    }

    return { stdout: "Empty workSpec" };
  }

  /**
   * Get the ACP client for direct access
   */
  getClient(): AcpClient {
    return this.client;
  }

  /**
   * Show the output channel
   */
  showOutput(): void {
    this.outputChannel.show(true);
  }
}

/**
 * Extension activation function for VS Code
 */
export function activateAcpExtension(
  _context: VscodeExtensionContext
): AcpExtensionManager {
  const manager = new AcpExtensionManager();
  manager.activate();
  return manager;
}