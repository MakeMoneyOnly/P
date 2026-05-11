import type { Db } from "@paperclipai/db";
import type { ServerAdapterModule } from "@paperclipai/adapter-utils";
import { WorkspaceDaemon } from "@paperclipai/acp-server";
import { logger } from "../middleware/logger.js";
import { buildExternalAdapters } from "../adapters/plugin-loader.js";
import { getServerAdapter, requireServerAdapter } from "../adapters/registry.js";

// ---------------------------------------------------------------------------
// WorkspaceDaemonService - Server-side service to manage workspace daemons
// ---------------------------------------------------------------------------

export interface WorkspaceDaemonServiceConfig {
  workspacePath: string;
  companyId?: string;
  adapterType?: string;
  port?: number;
  additionalDirectories?: string[];
}

export class WorkspaceDaemonService {
  private daemon: WorkspaceDaemon | null = null;
  private externalAdapters: ServerAdapterModule[] = [];
  private currentAdapterType: string = "process";

  constructor(
    private db: Db,
    private config: WorkspaceDaemonServiceConfig
  ) {
    if (config.adapterType) {
      this.currentAdapterType = config.adapterType;
    }
  }

  async loadExternalAdapters(): Promise<void> {
    this.externalAdapters = await buildExternalAdapters();
    logger.info(
      { count: this.externalAdapters.length, types: this.externalAdapters.map((a) => a.type) },
      "Loaded external adapters for workspace daemon"
    );
  }

  private getAdapterByType(adapterType: string): ServerAdapterModule {
    const external = this.externalAdapters.find((a) => a.type === adapterType);
    if (external) return external;
    return requireServerAdapter(adapterType);
  }

  async setAdapterType(adapterType: string): Promise<void> {
    if (this.isRunning()) {
      await this.stop();
    }
    this.currentAdapterType = adapterType;
    await this.start();
  }

  async start(): Promise<void> {
    if (this.daemon) {
      return;
    }

    await this.loadExternalAdapters();

    const adapter = this.getAdapterByType(this.currentAdapterType);
    logger.info({ workspacePath: this.config.workspacePath, adapterType: this.currentAdapterType, additionalDirectories: this.config.additionalDirectories }, "Starting workspace daemon");

    this.daemon = new WorkspaceDaemon({
      workspacePath: this.config.workspacePath,
      companyId: this.config.companyId,
      port: this.config.port,
      adapter,
      additionalDirectories: this.config.additionalDirectories,
    });

    // Set up event handlers
    this.daemon.on("fileChange", (event: unknown) => {
      logger.debug(event, "Workspace file changed");
    });

    this.daemon.on("sessionInitialized", (session: unknown) => {
      const s = session as { id: string; agentId: string };
      logger.info({ sessionId: s.id, agentId: s.agentId }, "ACP session initialized");
    });

    this.daemon.on("sessionClosed", (session: unknown) => {
      const s = session as { id: string };
      logger.info({ sessionId: s.id }, "ACP session closed");
    });

    this.daemon.on("agentExecute", (event: unknown) => {
      const e = event as { sessionId: string; prompt: string; runId: string };
      logger.info({ ...e }, "Agent execution requested");
    });

    await this.daemon.start();
    logger.info("Workspace daemon started successfully");
  }

  async stop(): Promise<void> {
    if (!this.daemon) {
      return;
    }

    await this.daemon.stop();
    this.daemon = null;
    logger.info("Workspace daemon stopped");
  }

  isRunning(): boolean {
    return this.daemon !== null;
  }

  getCurrentAdapterType(): string {
    return this.currentAdapterType;
  }

  getDaemon(): WorkspaceDaemon | null {
    return this.daemon;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let instance: WorkspaceDaemonService | null = null;

export function workspaceDaemonService(
  db: Db,
  config: WorkspaceDaemonServiceConfig
): WorkspaceDaemonService {
  if (!instance) {
    instance = new WorkspaceDaemonService(db, config);
  }
  return instance;
}

export function getWorkspaceDaemonService(): WorkspaceDaemonService | null {
  return instance;
}