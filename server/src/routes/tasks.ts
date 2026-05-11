import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { agentTaskSessions } from "@paperclipai/db";
import { eq, desc, sql } from "drizzle-orm";

export function taskRoutes(db: Db) {
  const router = Router();

  router.get("/tasks", async (_req, res) => {
    const tasks = await db
      .select({
        id: agentTaskSessions.id,
        companyId: agentTaskSessions.companyId,
        agentId: agentTaskSessions.agentId,
        taskKey: agentTaskSessions.taskKey,
        adapterType: agentTaskSessions.adapterType,
        status: sql<string>`CASE WHEN ${agentTaskSessions.lastError} IS NOT NULL THEN 'error' ELSE 'completed' END`,
        lastRunId: agentTaskSessions.lastRunId,
        lastError: agentTaskSessions.lastError,
        createdAt: agentTaskSessions.createdAt,
        updatedAt: agentTaskSessions.updatedAt,
        sessionDisplayId: agentTaskSessions.sessionDisplayId,
      })
      .from(agentTaskSessions)
      .orderBy(desc(agentTaskSessions.updatedAt));

    res.json({ tasks });
  });

  router.get("/tasks/:taskId", async (req, res) => {
    const { taskId } = req.params;

    const results = await db
      .select()
      .from(agentTaskSessions)
      .where(eq(agentTaskSessions.id, taskId))
      .limit(1);

    const task = results[0];
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    res.json({
      task,
      transcript: [],
    });
  });

  return router;
}