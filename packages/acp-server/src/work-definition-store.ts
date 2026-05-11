import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { WorkDefinition, WorkTaskStatus } from "@paperclipai/acp-types";

// ---------------------------------------------------------------------------
// WorkDefinitionStore - .paperclip/work directory management
// ---------------------------------------------------------------------------

export interface WorkDefinitionStoreOptions {
  workspacePath: string;
  companyId?: string;
  /** Optional rootPath to scope work definitions to a specific workspace root */
  rootPath?: string;
}

export class WorkDefinitionStore {
  private workPath: string;

  constructor(private options: WorkDefinitionStoreOptions) {
    this.workPath = join(options.workspacePath, ".paperclip", "work");
  }

  async initialize(): Promise<void> {
    await mkdir(this.workPath, { recursive: true });
  }

  async createTask(
    task: Omit<WorkDefinition, "id" | "metadata" | "status">
  ): Promise<WorkDefinition> {
    const id = `TASK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const fullTask: WorkDefinition = {
      ...task,
      id,
      status: "pending",
      metadata: {
        createdAt: now,
        createdBy: task.assignedTo || "unknown",
        updatedAt: now,
        iteration: 0,
      },
    };

    const filePath = this.getTaskFilePath(id);
    await writeFile(filePath, JSON.stringify(fullTask, null, 2));
    return fullTask;
  }

  async getTask(id: string): Promise<WorkDefinition | null> {
    try {
      const content = await readFile(this.getTaskFilePath(id), "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async listTasks(status?: WorkTaskStatus, workspaceId?: string): Promise<WorkDefinition[]> {
    let files: string[];
    try {
      files = await readdir(this.workPath);
    } catch {
      return [];
    }

    const tasks: WorkDefinition[] = [];

    for (const file of files) {
      if (file.endsWith(".task.json")) {
        const content = await readFile(join(this.workPath, file), "utf-8").catch(() => null);
        if (content) {
          try {
            const task = JSON.parse(content) as WorkDefinition;
            // Filter by workspaceId when provided
            if (workspaceId && task.workSpec?.cwd) {
              if (!task.workSpec.cwd.includes(workspaceId)) {
                continue;
              }
            }
            // Filter by rootPath if specified
            if (this.options.rootPath && task.workSpec?.cwd) {
              if (!task.workSpec.cwd.startsWith(this.options.rootPath)) {
                continue;
              }
            }
            if (!status || task.status === status) {
              tasks.push(task);
            }
          } catch {
            // Ignore malformed files
          }
        }
      }
    }

    return tasks.sort((a, b) => a.metadata.createdAt.localeCompare(b.metadata.createdAt));
  }

  async updateTask(id: string, patch: Partial<WorkDefinition>): Promise<WorkDefinition | null> {
    const existing = await this.getTask(id);
    if (!existing) return null;

    const updated: WorkDefinition = {
      ...existing,
      ...patch,
      id,
      metadata: {
        ...existing.metadata,
        updatedAt: new Date().toISOString(),
      },
    };

    await writeFile(this.getTaskFilePath(id), JSON.stringify(updated, null, 2));
    return updated;
  }

  async deleteTask(id: string): Promise<boolean> {
    try {
      await unlink(this.getTaskFilePath(id));
      return true;
    } catch {
      return false;
    }
  }

  private getTaskFilePath(id: string): string {
    return join(this.workPath, `${id}.task.json`);
  }
}