/**
 * Agent Client Protocol (ACP) 1.0 JSON-RPC 2.0 Types
 *
 * This module defines the core JSON-RPC 2.0 types for ACP communication
 * between IDE and workspace daemon. It follows the same patterns as the
 * existing plugin-sdk protocol.ts.
 *
 * @see packages/plugins/sdk/src/protocol.ts for reference
 */

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 Core Protocol Types
// ---------------------------------------------------------------------------

/** The JSON-RPC protocol version. Always `"2.0"`. */
export const JSONRPC_VERSION = "2.0" as const;

/**
 * A unique request identifier. JSON-RPC 2.0 allows strings or numbers;
 * we use strings (UUIDs or monotonic counters) for all ACP messages.
 */
export type JsonRpcId = string | number;

/**
 * A JSON-RPC 2.0 request message.
 */
export interface JsonRpcRequest<
  TMethod extends string = string,
  TParams = unknown,
> {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  readonly id: JsonRpcId;
  readonly method: TMethod;
  readonly params: TParams;
}

/**
 * A JSON-RPC 2.0 success response.
 */
export interface JsonRpcSuccessResponse<TResult = unknown> {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  readonly id: JsonRpcId;
  readonly result: TResult;
  readonly error?: never;
}

/**
 * A JSON-RPC 2.0 error object.
 */
export interface JsonRpcError<TData = unknown> {
  readonly code: number;
  readonly message: string;
  readonly data?: TData;
}

/**
 * A JSON-RPC 2.0 error response.
 */
export interface JsonRpcErrorResponse<TData = unknown> {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  readonly id: JsonRpcId | null;
  readonly result?: never;
  readonly error: JsonRpcError<TData>;
}

/**
 * A JSON-RPC 2.0 response.
 */
export type JsonRpcResponse<TResult = unknown, TData = unknown> =
  | JsonRpcSuccessResponse<TResult>
  | JsonRpcErrorResponse<TData>;

/**
 * A JSON-RPC 2.0 notification (no id, fire-and-forget).
 */
export interface JsonRpcNotification<
  TMethod extends string = string,
  TParams = unknown,
> {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  readonly id?: never;
  readonly method: TMethod;
  readonly params: TParams;
}

/**
 * Any well-formed JSON-RPC 2.0 message.
 */
export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcResponse
  | JsonRpcNotification;

// ---------------------------------------------------------------------------
// Error Codes
// ---------------------------------------------------------------------------

export const JSONRPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export type JsonRpcErrorCode =
  (typeof JSONRPC_ERROR_CODES)[keyof typeof JSONRPC_ERROR_CODES];

// ACP-specific error codes in the reserved server error range
export const ACP_ERROR_CODES = {
  SESSION_NOT_FOUND: -32000,
  WORKSPACE_NOT_FOUND: -32001,
  AGENT_NOT_AVAILABLE: -32002,
  TASK_NOT_FOUND: -32003,
  INVALID_TASK_STATE: -32004,
  PERMISSION_DENIED: -32005,
} as const;

export type AcpErrorCode =
  (typeof ACP_ERROR_CODES)[keyof typeof ACP_ERROR_CODES];

// ---------------------------------------------------------------------------
// ACP Session Types
// ---------------------------------------------------------------------------

export interface AcpSession {
   id: string;
   agentId: string;
   workspaceId: string;
   status: "initializing" | "active" | "closing" | "closed";
   createdAt: string;
   lastActivityAt: string;
   additionalDirectories?: string[];
}

export interface AcpSessionConfig {
   agentId: string;
   workspaceId: string;
   capabilities?: string[];
   mode?: "create" | "continue" | "resume";
   parentSessionId?: string;
   additionalDirectories?: string[];
}

// ---------------------------------------------------------------------------
// ACP Agent Types
// ---------------------------------------------------------------------------

export interface AcpAgent {
  id: string;
  type: string;
  name: string;
  status: "idle" | "running" | "paused" | "error";
  capabilities?: string[];
}

// ---------------------------------------------------------------------------
// ACP Task Types (Work Definition Protocol)
// ---------------------------------------------------------------------------

export type WorkTaskType = "execute" | "review" | "fix" | "test";
export type WorkTaskStatus = "pending" | "running" | "completed" | "failed";
export type WorkTaskPriority = "low" | "medium" | "high" | "critical";

export interface WorkDefinition {
  id: string;
  type: WorkTaskType;
  status: WorkTaskStatus;
  priority: WorkTaskPriority;
  assignedTo?: string;
  deadline?: string;
  dependencies: string[];
  workSpec: {
    command?: string;
    cwd?: string;
    env?: Record<string, string>;
    files?: string[];
    prompt?: string;
  };
  result?: {
    exitCode: number;
    stdout?: string;
    stderr?: string;
    artifacts?: string[];
    cost?: {
      inputTokens: number;
      outputTokens: number;
      costCents: number;
    };
  };
  metadata: {
    createdAt: string;
    createdBy: string;
    updatedAt: string;
    iteration: number;
  };
}

// ---------------------------------------------------------------------------
// ACP Workspace Types
// ---------------------------------------------------------------------------

export interface AcpWorkspace {
  id: string;
  path: string;
  companyId?: string;
  agentId?: string;
  status: "active" | "inactive";
  createdAt: string;
}

// Directory structure constants per spec
export const PAPERCLIP_DIR = ".paperclip";
export const WORK_DIR = ".paperclip/work";
export const STATE_DIR = ".paperclip/state";
export const CONFIG_DIR = ".paperclip/config";

// ---------------------------------------------------------------------------
// ACP Method Signatures
// ---------------------------------------------------------------------------

/**
 * Map of IDE→Workspace Daemon method names to their params/result types.
 */
export interface IdeToDaemonMethods {
  // Session management
  "session.initialize": [
    params: AcpSessionConfig,
    result: { sessionId: string; agent: AcpAgent }
  ];
  "session.close": [
    params: { sessionId: string },
    result: { closed: boolean }
  ];
  "session.status": [
    params: { sessionId: string },
    result: AcpSession
  ];

  // Task management
  "task.create": [
    params: Omit<WorkDefinition, "id" | "metadata" | "status"> & {
      workspaceId: string;
    },
    result: WorkDefinition
  ];
  "task.list": [
    params: { workspaceId: string; status?: WorkTaskStatus },
    result: WorkDefinition[]
  ];
  "task.get": [
    params: { taskId: string },
    result: WorkDefinition | null
  ];
  "task.update": [
    params: { taskId: string; patch: Partial<WorkDefinition> },
    result: WorkDefinition
  ];

  // Workspace management
  "workspace.get": [
    params: { workspaceId: string },
    result: AcpWorkspace | null
  ];
  "workspace.list": [
    params: Record<string, never>,
    result: AcpWorkspace[]
  ];

  // Agent execution
  "agent.execute": [
    params: {
      sessionId: string;
      prompt: string;
      workSpec?: WorkDefinition["workSpec"];
    },
    result: { runId: string }
  ];

  // IDE execution mode
  "agent.runInIde": [
    params: {
      sessionId: string;
      prompt: string;
      workSpec?: WorkDefinition["workSpec"];
    },
    result: { taskId: string }
  ];
  "ide.executeResult": [
    params: {
      taskId: string;
      result: {
        exitCode: number;
        stdout?: string;
        stderr?: string;
        summary?: string;
        errorMessage?: string;
      };
    },
    result: { success: boolean }
  ];
}

/**
 * Map of Workspace Daemon→IDE notification types.
 */
export interface DaemonToIdeNotifications {
  "session.statusChanged": {
    sessionId: string;
    status: AcpSession["status"];
  };
  "task.statusChanged": {
    taskId: string;
    status: WorkTaskStatus;
  };
  "file.change": {
    path: string;
    type: string;
  };
  "agent.output": {
    sessionId: string;
    type: "stdout" | "stderr" | "result";
    data: string;
  };
  "agent.error": {
    sessionId: string;
    error: JsonRpcError;
  };
  "task.executeRequest": {
    taskId: string;
    workSpec: WorkDefinition["workSpec"];
  };
}

// ---------------------------------------------------------------------------
// Typed Message Helpers
// ---------------------------------------------------------------------------

export type IdeToDaemonRequest<M extends keyof IdeToDaemonMethods> =
  JsonRpcRequest<M, IdeToDaemonMethods[M][0]>;

export type IdeToDaemonResponse<M extends keyof IdeToDaemonMethods> =
  JsonRpcSuccessResponse<IdeToDaemonMethods[M][1]>;

export type DaemonToIdeNotification<M extends keyof DaemonToIdeNotifications> =
  JsonRpcNotification<M, DaemonToIdeNotifications[M]>;