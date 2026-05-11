import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { FileWatcher, type FileWatcherOptions } from "./file-watcher.js";

describe("FileWatcher", () => {
  let fileWatcher: FileWatcher;

  afterEach(() => {
    if (fileWatcher) {
      fileWatcher.stop();
    }
  });

  describe("constructor", () => {
    it("accepts workspacePaths array", () => {
      fileWatcher = new FileWatcher({
        workspacePaths: ["/workspace/main", "/workspace/additional"],
      });

      expect(fileWatcher).toBeInstanceOf(FileWatcher);
    });

    it("supports backwards compatibility with workspacePath", () => {
      fileWatcher = new FileWatcher({
        workspacePath: "/workspace/main",
      });

      expect(fileWatcher).toBeInstanceOf(FileWatcher);
    });

    it("uses workspacePath as first path when both are provided", () => {
      fileWatcher = new FileWatcher({
        workspacePath: "/workspace/primary",
        workspacePaths: ["/workspace/secondary"],
      });

      expect(fileWatcher).toBeInstanceOf(FileWatcher);
    });
  });

  describe("computeRelativePath", () => {
    it("returns correct rootPath for file in first workspace", () => {
      fileWatcher = new FileWatcher({
        workspacePaths: ["/workspace/main"],
      });

      const result = (fileWatcher as any).computeRelativePath("/workspace/main/src/file.ts");
      expect(result.rootPath).toBe("/workspace/main");
      expect(result.relativePath).toBe("src/file.ts");
    });

    it("returns correct rootPath for file in second workspace", () => {
      fileWatcher = new FileWatcher({
        workspacePaths: ["/workspace/main", "/workspace/additional"],
      });

      const result = (fileWatcher as any).computeRelativePath("/workspace/additional/lib/util.ts");
      expect(result.rootPath).toBe("/workspace/additional");
      expect(result.relativePath).toBe("lib/util.ts");
    });

    it("returns empty rootPath for file outside all workspaces", () => {
      fileWatcher = new FileWatcher({
        workspacePaths: ["/workspace/main"],
      });

      const result = (fileWatcher as any).computeRelativePath("/other/path/file.ts");
      expect(result.rootPath).toBe("");
      expect(result.relativePath).toBe("/other/path/file.ts");
    });
  });

  describe("start", () => {
    it("returns early when paths array is empty", () => {
      fileWatcher = new FileWatcher({
        workspacePaths: [],
      });

      expect(() => fileWatcher.start()).not.toThrow();
    });

    it("handles single workspace path", () => {
      fileWatcher = new FileWatcher({
        workspacePaths: ["/workspace/single"],
      });

      expect(() => fileWatcher.start()).not.toThrow();
    });
  });
});