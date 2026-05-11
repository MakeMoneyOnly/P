import { Router } from "express";
import type { Db } from "@paperclipai/db";
import type { WorkTaskStatus } from "@paperclipai/acp-server";
import { workspaceDaemonService, getWorkspaceDaemonService } from "../services/index.js";
import { listServerAdapters, requireServerAdapter } from "../adapters/registry.js";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
const PAPERCLIP_DIR = ".paperclip";
const WORK_DIR = ".paperclip/work";
const STATE_DIR = ".paperclip/state";
const CONFIG_DIR = ".paperclip/config";

interface FileTreeNode {
  name: string;
  path: string;
  kind: "dir" | "file";
  children: FileTreeNode[];
  action?: string | null;
}

function mapAcpStatusToWorkspace(
  status: "initializing" | "active" | "closing" | "closed"
): "running" | "completed" | "error" | "stopped" {
  switch (status) {
    case "active":
      return "running";
    case "closed":
      return "stopped";
    case "initializing":
      return "running";
    case "closing":
      return "stopped";
    default:
      return "stopped";
  }
}

async function buildFileTree(dirPath: string, basePath: string): Promise<FileTreeNode[]> {
  const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);
  const nodes: FileTreeNode[] = [];

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    const relativePath = relative(basePath, fullPath);
    const statResult = await stat(fullPath).catch(() => null);

    if (!statResult) continue;

    if (entry.isDirectory()) {
      const children = await buildFileTree(fullPath, basePath);
      nodes.push({
        name: entry.name,
        path: relativePath,
        kind: "dir",
        children,
      });
    } else if (entry.isFile()) {
      nodes.push({
        name: entry.name,
        path: relativePath,
        kind: "file",
        children: [],
      });
    }
  }

  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function workspaceDaemonRoutes(db: Db) {
  const router = Router();

  router.get("/workspace-daemon/status", (_req, res) => {
    const service = getWorkspaceDaemonService();
    if (!service) {
      res.json({ running: false, adapterType: null, port: null });
      return;
    }
    const daemon = service.getDaemon();
    res.json({
      running: service.isRunning(),
      adapterType: service.getCurrentAdapterType(),
      port: daemon?.getPort?.() ?? null,
    });
  });

  router.post("/workspace-daemon/start", async (req, res) => {
    const { workspacePath, companyId, port, adapterType, additionalDirectories } = req.body as {
      workspacePath?: string;
      companyId?: string;
      port?: number;
      adapterType?: string;
      additionalDirectories?: string[];
    };

    if (!workspacePath) {
      res.status(400).json({ error: "workspacePath is required" });
      return;
    }

    const service = workspaceDaemonService(db, {
      workspacePath,
      companyId,
      port,
      adapterType,
      additionalDirectories,
    });

    try {
      await service.start();
      res.json({ running: true, workspacePath, adapterType: adapterType ?? "process", additionalDirectories });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to start workspace daemon: ${message}` });
    }
  });

  router.post("/workspace-daemon/stop", async (_req, res) => {
    const service = getWorkspaceDaemonService();
    if (!service) {
      res.json({ running: false });
      return;
    }

    try {
      await service.stop();
      res.json({ running: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to stop workspace daemon: ${message}` });
    }
  });

  router.get("/workspace-daemon/adapters", async (_req, res) => {
    const adapters = listServerAdapters();
    res.json({ adapters: adapters.map((a) => ({ type: a.type })) });
  });

  router.post("/workspace-daemon/adapter", async (req, res) => {
    const { adapterType } = req.body as { adapterType?: string };

    if (!adapterType) {
      res.status(400).json({ error: "adapterType is required" });
      return;
    }

    try {
      requireServerAdapter(adapterType);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: `Invalid adapter type: ${message}` });
      return;
    }

    const service = getWorkspaceDaemonService();
    if (!service) {
      res.status(400).json({ error: "Workspace daemon is not running" });
      return;
    }

    try {
      await service.setAdapterType(adapterType);
      res.json({ success: true, adapterType });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to change adapter: ${message}` });
    }
  });

  // -----------------------------------------------------------------------
  // Session Data Endpoints
  // -----------------------------------------------------------------------

  router.get("/workspace-daemon/sessions", (_req, res) => {
    const service = getWorkspaceDaemonService();
    if (!service || !service.isRunning()) {
      res.json({ sessions: [] });
      return;
    }

    const daemon = service.getDaemon();
    if (!daemon) {
      res.json({ sessions: [] });
      return;
    }

    const sessions = daemon.getSessions().map((s) => ({
      sessionId: s.id,
      agentId: s.agentId,
      status: mapAcpStatusToWorkspace(s.status),
      createdAt: s.createdAt,
      lastActivityAt: s.lastActivityAt,
      additionalDirectories: s.additionalDirectories,
    }));
    res.json({ sessions });
  });

  router.get("/workspace-daemon/sessions/:sessionId", (req, res) => {
    const { sessionId } = req.params;

    const service = getWorkspaceDaemonService();
    if (!service || !service.isRunning()) {
      res.status(404).json({ error: "Workspace daemon is not running" });
      return;
    }

    const daemon = service.getDaemon();
    if (!daemon) {
      res.status(404).json({ error: "Workspace daemon is not running" });
      return;
    }

    const session = daemon.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: `Session not found: ${sessionId}` });
      return;
    }

    const entries = daemon.getTranscriptEntries(sessionId);
    res.json({
      session: {
        sessionId: session.id,
        agentId: session.agentId,
        status: mapAcpStatusToWorkspace(session.status),
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt,
        additionalDirectories: session.additionalDirectories,
      },
      entries,
    });
  });

  // -----------------------------------------------------------------------
  // Work Definition Endpoints
  // -----------------------------------------------------------------------

  router.get("/workspace-daemon/work-definitions", async (req, res) => {
    const service = getWorkspaceDaemonService();
    if (!service || !service.isRunning()) {
      res.json({ workDefinitions: [] });
      return;
    }

    const daemon = service.getDaemon();
    if (!daemon) {
      res.json({ workDefinitions: [] });
      return;
    }

    const { status, workspaceId } = req.query as {
      status?: WorkTaskStatus;
      workspaceId?: string;
    };

    const workDefinitions = await daemon.getWorkDefinitions(status, workspaceId);
    res.json({ workDefinitions });
  });

  router.get("/workspace-daemon/work-definitions/:taskId", async (req, res) => {
    const { taskId } = req.params;

    const service = getWorkspaceDaemonService();
    if (!service || !service.isRunning()) {
      res.status(404).json({ error: "Workspace daemon is not running" });
      return;
    }

    const daemon = service.getDaemon();
    if (!daemon) {
      res.status(404).json({ error: "Workspace daemon is not running" });
      return;
    }

    const workDef = await daemon.getWorkDefinition(taskId);
    if (!workDef) {
      res.status(404).json({ error: `Work definition not found: ${taskId}` });
      return;
    }

    res.json({
      workDefinition: {
        ...workDef,
        output: workDef.result?.stdout ?? workDef.result?.stderr ?? null,
      },
    });
  });

  // -----------------------------------------------------------------------
  // Paperclip Files Endpoint
  // -----------------------------------------------------------------------

  router.get("/workspace-daemon/paperclip-files", async (req, res) => {
    const { workspacePath } = req.query as { workspacePath?: string };

    if (!workspacePath) {
      res.status(400).json({ error: "workspacePath query parameter is required" });
      return;
    }

    const paperclipDir = join(workspacePath, PAPERCLIP_DIR);
    const subdirs = [WORK_DIR, STATE_DIR, CONFIG_DIR];

    const nodes: FileTreeNode[] = [];

    for (const subdir of subdirs) {
      const dirPath = join(workspacePath, subdir);
      const children = await buildFileTree(dirPath, workspacePath).catch(() => []);
      const segment = subdir.split("/")[1];
      nodes.push({
        name: segment,
        path: `.paperclip/${segment}`,
        kind: "dir",
        children,
      });
    }

    res.json({ files: nodes });
  });

  return router;
}
