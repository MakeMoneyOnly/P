# ACP Usage Guide - IDE-Native Agent Mode

Status: V1 implementation guide  
Date: 2026-05-08  
Audience: IDE extension developers, agent operators

## 1. Overview

The Agent Client Protocol (ACP) enables IDE-native agent execution via JSON-RPC 2.0 over WebSocket. This guide covers how to integrate ACP into an IDE or editor for direct agent control alongside file editing.

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          IDE (Editor)                           │
│  ┌──────────────────┐    WebSocket     ┌─────────────────────┐  │
│  │   ACP Client     │◄──────────────────►│  Workspace Daemon  │  │
│  │ (IDE Extension) │   JSON-RPC 2.0    │   (ACP Server)    │  │
│  └──────────────────┘                   └─────────────────────┘  │
│                                                                 │
│                              │                                  │
│                              ▼                                  │
│                    ┌─────────────────────┐                      │
│                    │  Server Adapter     │                      │
│                    │ (e.g., Pi, OpenCode)│                      │
│                    └─────────────────────┘                      │
│                                                                 │
│                              │                                  │
│                              ▼                                  │
│                    ┌─────────────────────┐                      │
│                    │  File Watcher       │                      │
│                    │  (chokidar)         │                      │
│                    └─────────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

## 3. IDE Integration Requirements

### 3.1 WebSocket Connection

The IDE must establish a WebSocket connection to the workspace daemon:

```typescript
// Example connection setup
const wsUrl = "ws://127.0.0.1:3101"; // Default ACP port
const ws = new WebSocket(wsUrl);
```

### 3.2 JSON-RPC 2.0 Message Format

All messages follow the JSON-RPC 2.0 specification:

```typescript
// Request (with expected response)
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session.initialize",
  "params": { "agentId": "agent-123", "workspaceId": "ws-456" }
}

// Response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "sessionId": "session-abc", "agent": { ... } }
}

// Notification (fire-and-forget)
{
  "jsonrpc": "2.0",
  "method": "agent.output",
  "params": { "sessionId": "session-abc", "type": "stdout", "data": "..." }
}

## 4. Session Lifecycle

### 4.1 Initialize a Session

Create a session before executing any agent commands:

```typescript
// ID: 1
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session.initialize",
  "params": {
    "agentId": "agent-123",
    "workspaceId": "ws-main",
    "mode": "create",           // or "continue" | "resume"
    "parentSessionId": null     // for child sessions
  }
}

// Response: ID: 1
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "sessionId": "session-xyz",
    "agent": {
      "id": "agent-123",
      "type": "pi_local",
      "name": "Dev Agent",
      "status": "idle"
    }
  }
}

### 4.2 Execute Agent Commands

Execute the agent within the session:

```typescript
// ID: 2
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "agent.execute",
  "params": {
    "sessionId": "session-xyz",
    "prompt": "Fix the TypeScript error in src/index.ts",
    "workSpec": {
      "cwd": "/path/to/workspace",
      "files": ["src/index.ts"],
      "env": { "NODE_ENV": "development" }
    }
  }
}

### 4.3 Stream Notifications

The daemon sends streaming notifications during execution:

```typescript
// agent.output notification
{
  "jsonrpc": "2.0",
  "method": "agent.output",
  "params": {
    "sessionId": "session-xyz",
    "type": "stdout",
    "data": "Reading file src/index.ts..."
  }
}

// agent.output (result)
{
  "jsonrpc": "2.0",
  "method": "agent.output",
  "params": {
    "sessionId": "session-xyz",
    "type": "result",
    "data": "Fixed the TypeScript error by adding the missing type annotation."
  }
}

### 4.4 Close a Session

Clean up when done:

```typescript
// ID: 3
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "session.close",
  "params": {
    "sessionId": "session-xyz"
  }
}

// Response: ID: 3
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": { "closed": true }
}

## 5. Task Management

ACP provides work definition (task) management integrated with the workspace daemon.

### 5.1 Create a Task

```typescript
// ID: 4
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "task.create",
  "params": {
    "workspaceId": "ws-main",
    "type": "execute",
    "priority": "high",
    "workSpec": {
      "command": "npm test",
      "cwd": "/path/to/workspace",
      "files": ["src/**/*.test.ts"]
    },
    "dependencies": []
  }
}

// Response: ID: 4
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "id": "TASK-20260508-abc123",
    "type": "execute",
    "status": "pending",
    "priority": "high",
    "dependencies": [],
    "workSpec": { ... },
    "metadata": {
      "createdAt": "2026-05-08T10:00:00Z",
      "createdBy": "agent-123",
      "updatedAt": "2026-05-08T10:00:00Z",
      "iteration": 0
    }
  }
}

### 5.2 List Tasks

```typescript
// ID: 5
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "task.list",
  "params": {
    "workspaceId": "ws-main",
    "status": "pending"  // optional filter
  }
}

// Response: ID: 5
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": [
    {
      "id": "TASK-20260508-abc123",
      "type": "execute",
      "status": "pending",
      "priority": "high",
      "workSpec": { ... },
      "metadata": { ... }
    }
  ]
}

### 5.3 Get Task Status

```typescript
// ID: 6
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "task.get",
  "params": {
    "taskId": "TASK-20260508-abc123"
  }
}

### 5.4 Update a Task

```typescript
// ID: 7
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "task.update",
  "params": {
    "taskId": "TASK-20260508-abc123",
    "patch": {
      "status": "running"
    }
  }
}

## 6. File Watching Notifications

The workspace daemon uses a file watcher (chokidar) to monitor workspace directories for changes. Clients receive `file.change` notifications when files matching their workspaceId are modified.

### 6.1 file.change Notification

When a file is created, modified, or deleted within a watched directory, clients receive:

```typescript
{
  "jsonrpc": "2.0",
  "method": "file.change",
  "params": {
    "path": "/path/to/workspace/src/index.ts",
    "type": "modified"  // "created" | "modified" | "deleted"
  }
}
```

The file watcher:
- Monitors the primary workspace directory (workspacePath)
- Watches additional directories when configured (AdditionalDirectories)
- Ignores patterns: dotfiles, node_modules/, .git/, .paperclip/state/, .paperclip/config/

### 6.2 session.statusChanged Notification

Sent after a session status change, such as after `session.close`:

```typescript
// session.statusChanged notification
{
  "jsonrpc": "2.0",
  "method": "session.statusChanged",
  "params": {
    "sessionId": "session-xyz",
    "status": "closed"  // "initialized" | "running" | "closed" | "error"
  }
}
```

### 6.3 task.statusChanged Notification

Sent after `task.update` when the task status changes:

```typescript
// task.statusChanged notification
{
  "jsonrpc": "2.0",
  "method": "task.statusChanged",
  "params": {
    "taskId": "TASK-20260508-abc123",
    "status": "running"  // "pending" | "running" | "completed" | "failed" | "cancelled"
  }
}
```



