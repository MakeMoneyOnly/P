import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { AcpSessionConfig, AcpSession } from "@paperclipai/acp-types";
import { WorkspaceDaemon, type WorkspaceDaemonConfig } from "./workspace-daemon.js";
import type { TranscriptEntry } from "./workspace-daemon.js";

describe("WorkspaceDaemon", () => {
  let daemon: WorkspaceDaemon;
  const mockConfig: WorkspaceDaemonConfig = {
    workspacePath: "/workspace/test",
    additionalDirectories: ["/workspace/extra"],
    port: 3102,
    host: "127.0.0.1",
  };

  beforeEach(() => {
    daemon = new WorkspaceDaemon(mockConfig);
  });

  afterEach(() => {
    // Clean up any sessions
    daemon.getSessions().forEach((session) => {
      daemon.getSession(session.id);
    });
  });

  describe("session management", () => {
    it("stores additionalDirectories from session config", () => {
      const config: AcpSessionConfig = {
        agentId: "test-agent",
        workspaceId: "test-workspace",
        additionalDirectories: ["/workspace/addon1", "/workspace/addon2"],
      };

      // Access the private method via type assertion
      (daemon as any).initializeSession(config, {} as any);

      const sessions = daemon.getSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].additionalDirectories).toEqual(["/workspace/addon1", "/workspace/addon2"]);
    });

    it("stores session without additionalDirectories when not provided", () => {
      const config: AcpSessionConfig = {
        agentId: "test-agent",
        workspaceId: "test-workspace",
      };

      (daemon as any).initializeSession(config, {} as any);

      const sessions = daemon.getSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].additionalDirectories).toBeUndefined();
    });

    it("retrieves single session via getSession", () => {
      const config: AcpSessionConfig = {
        agentId: "test-agent",
        workspaceId: "test-workspace",
      };

      (daemon as any).initializeSession(config, {} as any);

      const sessions = daemon.getSessions();
      const session = daemon.getSession(sessions[0].id);

      expect(session).toBeDefined();
      expect(session?.id).toBe(sessions[0].id);
      expect(session?.agentId).toBe("test-agent");
    });

    it("returns undefined for non-existent session", () => {
      const session = daemon.getSession("non-existent-id");
      expect(session).toBeUndefined();
    });

    it("returns all sessions via getSessions", () => {
      const config1: AcpSessionConfig = {
        agentId: "agent-1",
        workspaceId: "workspace-1",
      };
      const config2: AcpSessionConfig = {
        agentId: "agent-2",
        workspaceId: "workspace-2",
      };

      (daemon as any).initializeSession(config1, {} as any);
      (daemon as any).initializeSession(config2, {} as any);

      const sessions = daemon.getSessions();
      expect(sessions).toHaveLength(2);
    });

    it("closeSession removes session", async () => {
      const config: AcpSessionConfig = {
        agentId: "test-agent",
        workspaceId: "test-workspace",
      };

      const session = await (daemon as any).initializeSession(config, {} as any);
      expect(daemon.getSession(session.id)).toBeDefined();

      // closeSession is private - invoke via private method with correct params
      const result = await (daemon as any).closeSession({ sessionId: session.id });
      expect(result.closed).toBe(true);
      expect(daemon.getSession(session.id)).toBeUndefined();
    });

    it("closeSession returns closed false for non-existent session", async () => {
      const result = await (daemon as any).closeSession({ sessionId: "non-existent-id" });
      expect(result.closed).toBe(false);
    });
  });

describe("transcript entry storage and retrieval", () => {
     it("gets empty transcript for session with no entries", () => {
       const config: AcpSessionConfig = {
         agentId: "test-agent",
         workspaceId: "test-workspace",
       };

       const session = (daemon as any).initializeSession(config, {} as any);
       const entries = daemon.getTranscriptEntries(session.id);

       expect(entries).toEqual([]);
     });

     it("stores and retrieves transcript entries", () => {
       const config: AcpSessionConfig = {
         agentId: "test-agent",
         workspaceId: "test-workspace",
       };

       const session = (daemon as any).initializeSession(config, {} as any);

       const entry: TranscriptEntry = {
         sessionId: session.id,
         type: "stdout",
         data: "Hello, world!",
         timestamp: new Date().toISOString(),
       };

       // Access private method to add entry
       daemon["transcriptEntries"].set(session.id, [entry]);

       const entries = daemon.getTranscriptEntries(session.id);
       expect(entries).toHaveLength(1);
       expect(entries[0].data).toBe("Hello, world!");
       expect(entries[0].type).toBe("stdout");
     });

     it("stores multiple transcript entries for same session", () => {
       const config: AcpSessionConfig = {
         agentId: "test-agent",
         workspaceId: "test-workspace",
       };

       const session = (daemon as any).initializeSession(config, {} as any);

       const entry1: TranscriptEntry = {
         sessionId: session.id,
         type: "stdout",
         data: "Line 1",
         timestamp: new Date().toISOString(),
       };
       const entry2: TranscriptEntry = {
         sessionId: session.id,
         type: "stderr",
         data: "Error output",
         timestamp: new Date().toISOString(),
       };

       daemon["transcriptEntries"].set(session.id, [entry1, entry2]);

       const entries = daemon.getTranscriptEntries(session.id);
       expect(entries).toHaveLength(2);
       expect(entries[0].type).toBe("stdout");
       expect(entries[1].type).toBe("stderr");
     });
   });

   describe("workspace handlers", () => {
     it("listWorkspaces returns workspace derived from config", async () => {
       const workspaces = await (daemon as any).listWorkspaces();

       expect(workspaces).toHaveLength(1);
       expect(workspaces[0].id).toBe("/workspace/test");
       expect(workspaces[0].path).toBe("/workspace/test");
       expect(workspaces[0].status).toBe("active");
     });

     it("listWorkspaces includes companyId when provided", async () => {
       const companyDaemon = new WorkspaceDaemon({
         ...mockConfig,
         companyId: "company-123",
       });

       const workspaces = await (companyDaemon as any).listWorkspaces();

       expect(workspaces[0].companyId).toBe("company-123");
     });

     it("getWorkspace returns workspace when id matches", async () => {
       const workspace = await (daemon as any).getWorkspace({
         workspaceId: "/workspace/test",
       });

       expect(workspace).not.toBeNull();
       expect(workspace?.id).toBe("/workspace/test");
       expect(workspace?.path).toBe("/workspace/test");
     });

     it("getWorkspace returns null when id does not match", async () => {
       const workspace = await (daemon as any).getWorkspace({
         workspaceId: "/other/workspace",
       });

       expect(workspace).toBeNull();
     });
   });
});