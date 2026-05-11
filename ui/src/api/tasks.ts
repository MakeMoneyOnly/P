import { api } from "./client";

export type TaskStatus = "pending" | "running" | "completed" | "error" | "paused" | "stopped";

export interface Task {
  id: string;
  companyId: string;
  agentId: string;
  agentName?: string;
  taskKey: string;
  adapterType: string;
  status: TaskStatus;
  lastRunId?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  sessionDisplayId?: string;
}

export interface TaskSession {
  id: string;
  agentId: string;
  agentName?: string;
  status: TaskStatus;
  lastRunId?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDetail extends Task {
  sessionParams?: Record<string, unknown>;
  transcript?: TaskTranscriptEntry[];
}

export interface TaskTranscriptEntry {
  sessionId: string;
  type: "stdout" | "stderr";
  data: string;
  timestamp: string;
}

export interface TasksListResponse {
  tasks: Task[];
}

export interface TaskDetailResponse {
  task: TaskDetail;
  transcript: TaskTranscriptEntry[];
}

export const tasksApi = {
  list: () => api.get<TasksListResponse>("/tasks"),

  get: (taskId: string) => api.get<TaskDetailResponse>(`/tasks/${taskId}`),
};