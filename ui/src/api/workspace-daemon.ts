import { api } from "./client";

export type WorkTaskType = "execute" | "review" | "fix" | "test";
export type WorkTaskStatus = "pending" | "running" | "completed" | "failed";
export type WorkTaskPriority = "low" | "medium" | "high" | "critical";

export interface FileTreeNode {
  name: string;
  path: string;
  kind: "dir" | "file";
  children: FileTreeNode[];
  action?: string | null;
}

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
  output?: string | null;
}

export interface DaemonTranscriptEntry {
  sessionId: string;
  type: "stdout" | "stderr";
  data: string;
  timestamp: string;
}

export interface WorkspaceDaemonStatus {
  running: boolean;
  adapterType: string | null;
  port: number | null;
}

export interface WorkspaceDaemonStartParams {
  workspacePath: string;
  companyId?: string;
  port?: number;
  adapterType?: string;
}

export interface WorkspaceDaemonStartResponse {
  running: boolean;
  workspacePath: string;
  adapterType: string;
}

export interface StartResult {
  success: boolean;
  adapterType: string;
}

export interface AdapterInfo {
  type: string;
}

export interface WorkspaceSession {
  sessionId: string;
  agentId: string | null;
  status: "running" | "completed" | "error" | "stopped";
  createdAt: string;
  lastActivityAt: string | null;
}

export const workspaceDaemonApi = {
  getStatus: () => api.get<WorkspaceDaemonStatus>("/workspace-daemon/status"),

  start: (params: WorkspaceDaemonStartParams) =>
    api.post<WorkspaceDaemonStartResponse>("/workspace-daemon/start", params),

  stop: () => api.post<{ running: boolean }>("/workspace-daemon/stop", {}),

  getAdapters: () => api.get<{ adapters: AdapterInfo[] }>("/workspace-daemon/adapters"),

  setAdapterType: (adapterType: string) =>
    api.post<StartResult>("/workspace-daemon/adapter", { adapterType }),

  getSessions: () => api.get<{ sessions: WorkspaceSession[] }>("/workspace-daemon/sessions"),

  getSessionDetail: (sessionId: string) =>
    api.get<{ session: WorkspaceSession; entries: DaemonTranscriptEntry[] }>(
      `/workspace-daemon/sessions/${sessionId}`
    ),

  getWorkDefinitions: (status?: WorkTaskStatus, workspaceId?: string) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (workspaceId) params.set("workspaceId", workspaceId);
    const query = params.toString();
    return api.get<{ workDefinitions: WorkDefinition[] }>(
      `/workspace-daemon/work-definitions${query ? `?${query}` : ""}`
    );
  },

  getWorkDefinition: (taskId: string) =>
    api.get<{ workDefinition: WorkDefinition }>(`/workspace-daemon/work-definitions/${taskId}`),

  getPaperclipFiles: (workspacePath: string) =>
    api.get<{ files: FileTreeNode[] }>(
      `/workspace-daemon/paperclip-files?workspacePath=${encodeURIComponent(workspacePath)}`
    ),
};