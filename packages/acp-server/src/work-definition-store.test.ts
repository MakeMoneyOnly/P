import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { WorkDefinitionStore } from "./work-definition-store.js";

describe("WorkDefinitionStore", () => {
  let testDir: string;
  let store: WorkDefinitionStore;

  beforeEach(() => {
    testDir = mkdtempSync(join(import.meta.dirname, "../../../.test-work-"));
    store = new WorkDefinitionStore({
      workspacePath: testDir,
    });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("createTask", () => {
    it("creates a work definition with required fields", async () => {
      await store.initialize();

      const task = await store.createTask({
        type: "execute",
        priority: "medium",
        dependencies: [],
        workSpec: {
          prompt: "Test task",
        },
      });

      expect(task.id).toMatch(/^TASK-/);
      expect(task.type).toBe("execute");
      expect(task.priority).toBe("medium");
      expect(task.dependencies).toEqual([]);
      expect(task.workSpec.prompt).toBe("Test task");
      expect(task.status).toBe("pending");
      expect(task.metadata).toBeDefined();
      expect(task.metadata.createdAt).toBeDefined();
      expect(task.metadata.updatedAt).toBeDefined();
    });

    it("accepts assignedTo field", async () => {
      await store.initialize();

      const task = await store.createTask({
        type: "fix",
        priority: "high",
        dependencies: [],
        assignedTo: "agent-123",
        workSpec: {
          prompt: "Fix the bug",
        },
      });

      expect(task.assignedTo).toBe("agent-123");
    });
  });

  describe("getTask", () => {
    it("returns null for non-existent task", async () => {
      await store.initialize();

      const result = await store.getTask("non-existent");
      expect(result).toBeNull();
    });

    it("retrieves created task by id", async () => {
      await store.initialize();

      const created = await store.createTask({
        type: "test",
        priority: "low",
        dependencies: [],
        workSpec: { prompt: "Test" },
      });

      const retrieved = await store.getTask(created.id);
      expect(retrieved).toEqual(created);
    });
  });

  describe("listTasks", () => {
    it("returns empty array when no tasks exist", async () => {
      await store.initialize();

      const tasks = await store.listTasks();
      expect(tasks).toEqual([]);
    });

    it("lists all tasks", async () => {
      await store.initialize();

      await store.createTask({
        type: "execute",
        priority: "medium",
        dependencies: [],
        workSpec: { prompt: "Task 1" },
      });

      await store.createTask({
        type: "fix",
        priority: "high",
        dependencies: [],
        workSpec: { prompt: "Task 2" },
      });

      const tasks = await store.listTasks();
      expect(tasks).toHaveLength(2);
    });

    it("filters by status", async () => {
      await store.initialize();

      const pendingTask = await store.createTask({
        type: "execute",
        priority: "medium",
        dependencies: [],
        workSpec: { prompt: "Pending" },
      });

      await store.updateTask(pendingTask.id, { status: "running" });

      const pendingTasks = await store.listTasks("pending");
      expect(pendingTasks).toHaveLength(0);

      const runningTasks = await store.listTasks("running");
      expect(runningTasks).toHaveLength(1);
    });

    it("filters by rootPath when specified", async () => {
      await store.initialize();

      const store1 = new WorkDefinitionStore({
        workspacePath: testDir,
        rootPath: "/workspace/main",
      });
      await store1.initialize();

      await store1.createTask({
        type: "execute",
        priority: "medium",
        dependencies: [],
        workSpec: { cwd: "/workspace/main/src", prompt: "Task in main" },
      });

      await store1.createTask({
        type: "fix",
        priority: "high",
        dependencies: [],
        workSpec: { cwd: "/workspace/other/src", prompt: "Task in other" },
      });

      const tasks = await store1.listTasks();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].workSpec.cwd).toBe("/workspace/main/src");
    });
  });

  describe("updateTask", () => {
    it("returns null for non-existent task", async () => {
      await store.initialize();

      const result = await store.updateTask("non-existent", { status: "completed" });
      expect(result).toBeNull();
    });

    it("updates task with patch", async () => {
      await store.initialize();

      const created = await store.createTask({
        type: "execute",
        priority: "medium",
        dependencies: [],
        workSpec: { prompt: "Original" },
      });

      const updated = await store.updateTask(created.id, { status: "completed" });

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("completed");
      expect(updated!.metadata.updatedAt).toBeDefined();
    });
  });
});