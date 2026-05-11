import { EventEmitter } from "node:events";
import chokidar, { type FSWatcher } from "chokidar";

// ---------------------------------------------------------------------------
// FileWatcher - Chokidar-based file watching with debounced notifications
// ---------------------------------------------------------------------------

export interface FileWatcherOptions {
  /** @deprecated Use workspacePaths instead. Kept for backwards compatibility. */
  workspacePath?: string;
  /** Array of workspace paths to watch. Primary workspace first, then additional directories. */
  workspacePaths?: string[];
  debounceMs?: number;
  ignorePatterns?: RegExp[];
  ignored?: string[];
}

export type FileChangeEvent = {
  type: "create" | "update" | "delete";
  path: string;
  relativePath: string;
  rootPath: string;
  timestamp: string;
};

export type FileChangeHandler = (event: FileChangeEvent) => void;

export class FileWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private pendingEvents: FileChangeEvent[] = [];
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private workspacePaths: string[];

  constructor(private options: FileWatcherOptions) {
    super();
    // Backwards compatibility: if workspacePath is provided, treat as workspacePaths[0]
    this.workspacePaths = options.workspacePaths ?? 
      (options.workspacePath ? [options.workspacePath] : []);
  }

  start(): void {
    if (this.watcher) {
      return;
    }

    if (this.workspacePaths.length === 0) {
      return;
    }

    this.watcher = chokidar.watch(this.workspacePaths, {
      ignored: this.options.ignored ?? [
        /(^|[\\/])\../, // dotfiles
        "**/node_modules/**",
        "**/.git/**",
        "**/.paperclip/state/**",
        "**/.paperclip/config/**",
      ],
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher
      .on("add", (p: string) => this.handleEvent("create", p))
      .on("change", (p: string) => this.handleEvent("update", p))
      .on("unlink", (p: string) => this.handleEvent("delete", p))
      .on("error", (err: unknown) => {
        console.error("FileWatcher error:", err);
      });
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
  }

  private handleEvent(type: "create" | "update" | "delete", absolutePath: string): void {
    const { relativePath, rootPath } = this.computeRelativePath(absolutePath);
    const event: FileChangeEvent = {
      type,
      path: absolutePath,
      relativePath,
      rootPath,
      timestamp: new Date().toISOString(),
    };
    this.enqueueEvent(event);
  }

  private enqueueEvent(event: FileChangeEvent): void {
    this.pendingEvents.push(event);
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      for (const event of this.pendingEvents) {
        this.emit("change", event);
      }
      this.pendingEvents = [];
    }, this.options.debounceMs ?? 100);
  }

  private computeRelativePath(absolutePath: string): { relativePath: string; rootPath: string } {
    // Find which workspace root this file belongs to
    for (const rootPath of this.workspacePaths) {
      if (absolutePath.startsWith(rootPath)) {
        return {
          relativePath: absolutePath.slice(rootPath.length).replace(/^[\\/]/, ""),
          rootPath,
        };
      }
    }
    // If not under any workspace, return as-is with empty rootPath
    return { relativePath: absolutePath, rootPath: "" };
  }
}