# ACP Migration Guide: Heartbeat API to ACP

Status: V1 implementation guide  
Date: 2026-05-08  
Audience: Agent operators, adapter developers

## 1. Overview

This guide covers migrating from the heartbeat API model to the Agent Client Protocol (ACP) model. ACP provides IDE-native agent execution with better real-time streaming and session semantics.

## 2. Key Differences

### 2.1 Session vs Run Model

**Heartbeat API (Run Model):**
```typescript
// Heartbeat invokes agent based on scheduled runs or issue assignment
POST /agents/:agentId/heartbeat/invoke
{
  "runType": "scheduled",
  "context": { "issueId": "..." }
}

// Response
{
  "runId": "run-123",
  "status": "queued"
}
```

**ACP (Session Model):**
```typescript
// Explicit session lifecycle
// 1. Initialize first
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session.initialize",
  "params": { "agentId": "agent-123", "workspaceId": "ws-456" }
}

// 2. Then execute within session
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "agent.execute",
  "params": { "sessionId": "session-xyz", "prompt": "..." }
}
```

**Migration Impact:**
- Sessions are explicitly managed by the IDE, not internally by Paperclip
- Each IDE connection has its own session context
- Sessions can be resumed with `mode: "resume"`

### 2.2 Work Definition vs Issue Model

**Heartbeat API (Issues):**
- Issues are database entities with assignees
- State transitions: `backlog` → `todo` → `in_progress` → `done`
- Atomic checkout via `POST /issues/:id/checkout`
- Work tracked via heartbeat runs

**ACP (Work Definitions):**
```typescript
interface WorkDefinition {
  id: string;
  type: "execute" | "review" | "fix" | "test";
  status: "pending" | "running" | "completed" | "failed";
  priority: "low" | "medium" | "high" | "critical";
  workSpec: {
    command?: string;
    cwd?: string;
    env?: Record<string, string>;
    files?: string[];
    prompt?: string;
  };
  result?: {
    exitCode: number;
    stdout?: string;
    stderr?: string;
    artifacts?: string[];
    cost?: { inputTokens: number; outputTokens: number; costCents: number };
  };
}
```

**Migration Impact:**
- Work definitions are lightweight and stored in `.paperclip/work/`
- No atomic checkout semantics - simpler local execution model
- Direct file-based persistence, not database-bound

### 2.3 Notification Streaming

**Heartbeat API:**
- Polling via `GET /runs/:runId/events` (SSE)
- Events batched and delivered on interval
- Limited real-time capability

**ACP:**
```typescript
// Real-time JSON-RPC notifications over WebSocket
{
  "jsonrpc": "2.0",
  "method": "agent.output",
  "params": {
    "sessionId": "session-xyz",
    "type": "stdout",
    "data": "Current output line\n"
  }
}

// Multiple notification types
"session.statusChanged"  // Session lifecycle
"task.statusChanged"     // Work definition changes
"agent.output"           // Streaming stdout/stderr/result
"agent.error"            // Error events
```

**Migration Impact:**
- Immediate streaming to IDE
- No polling required
- Structured notifications with type information

## 3. Configuration Mapping

### 3.1 Heartbeat Configuration

```typescript
// Heartbeat adapter config
{
  "type": "process",
  "command": "node",
  "args": ["agent.js"],
  "env": { "AGENT_ID": "..." },
  "timeoutSec": 900,
  "graceSec": 15
}
```

### 3.2 ACP Configuration

```typescript
// ACP session config
{
  "agentId": "agent-xyz",
  "workspaceId": "ws-main",
  "mode": "create",
  "additionalDirectories": ["../shared", "../libs"]
}

// Adapter config (same as heartbeat)
{
  "type": "pi_local",
  "command": "pi",
  "model": "anthropic/claude-3-opus",
  "cwd": "/workspace",
  "timeoutSec": 900
}
```

## 4. Code Migration Examples

### 4.1 Creating and Executing

**Before (Heartbeat):**
```typescript
// Trigger via heartbeat
const response = await fetch(`/api/agents/${agentId}/heartbeat/invoke`, {
  method: "POST",
  headers: { "Authorization": `Bearer ${apiKey}` },
  body: JSON.stringify({
    context: { issueId: issueId }
  })
});
const { runId } = await response.json();

// Poll for updates
const events = await fetch(`/api/runs/${runId}/events`);
```

**After (ACP):**
```typescript
// Initialize session
const { sessionId } = await client.initializeSession({
  agentId: agentId,
  workspaceId: workspaceId
});

// Execute directly
const { runId } = await client.execute(sessionId, prompt);

// Receive streaming updates via onOutput callback
client.on("output", (sessionId, type, data) => {
  console.log(`[${type}]`, data);
});
```

### 4.2 Task Management

**Before (Heartbeat):**
```typescript
// Database issues
const issues = await api.get(`/issues?assignee=${agentId}`);
for (const issue of issues) {
  const comments = await api.get(`/issues/${issue.id}/comments`);
}
```

**After (ACP):**
```typescript
// Local work definitions
const tasks = await client.listTasks(workspaceId, "pending");
for (const task of tasks) {
  // Tasks are local files, no network calls
  console.log("Task:", task.workSpec.prompt);
}

// Create new task
const task = await client.createTask({
  workspaceId,
  type: "execute",
  priority: "high",
  workSpec: { prompt: "Fix the bug" }
});
```

### 4.3 File Watching

**Before (Heartbeat):**
- File changes detected via repository polling
- Changes surfaced through issue comments

**After (ACP):**
```typescript
// Real-time file watching
const daemon = new WorkspaceDaemon({
  workspacePath: "/workspace",
  additionalDirectories: ["/shared"]
});

daemon.on("fileChange", (event) => {
  console.log(`${event.type}: ${event.relativePath}`);
  // IDE can update UI in real-time
});
```

## 5. Adapter Migration

### 5.1 Heartbeat Adapter Interface

```typescript
// Old interface
interface AgentAdapter {
  invoke(agent: Agent, context: InvocationContext): Promise<InvokeResult>;
  status(run: HeartbeatRun): Promise<RunStatus>;
  cancel(run: HeartbeatRun): Promise<void>;
}
```

### 5.2 ACP Adapter Interface

```typescript
// New interface (same core, extended context)
interface ServerAdapterModule {
  type: string;
  execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult>;
  testEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult>;
  // ... additional optional methods
}
```

**Key Changes:**
- `context` expanded to include `workSpec`, `prompt` directly
- `onLog` callback for streaming (replaces internal stdout capture)
- Session persistence via `sessionParams` in result

## 6. Multi-Root Migration

**Heartbeat:**
- Single workspace per agent config
- No dynamic directory addition

**ACP:**
```typescript
// Multi-root support
const session = await client.initializeSession({
  agentId: "agent-123",
  workspaceId: "monorepo",
  additionalDirectories: [
    "/workspace/packages/core",
    "/workspace/packages/ui",
    "/workspace/packages/api"
  ]
});

// File notifications include root context
daemon.on("fileChange", ({ relativePath, rootPath }) => {
  console.log(`Changed in ${path.relative(rootPath, relativePath)}`);
});
```

## 7. Security Considerations

### 7.1 Authentication

**Heartbeat:**
- Bearer API key for each request
- Board vs agent scopes

**ACP:**
- API keys not required for local daemon
- Future: Session tokens for remote scenarios

### 7.2 File Access

**Heartbeat:**
- Agents operate in configured `cwd`
- Access controlled by agent config

**ACP:**
- All session directories watched
- Additional directories explicitly configured
- IDE has direct file system access

## 8. Migration Checklist

- [ ] Identify sessions vs runs in your workflow
- [ ] Map issue workflow to work definitions
- [ ] Update IDE integration to use WebSocket/JSON-RPC
- [ ] Implement real-time output handlers
- [ ] Configure file watchers for multi-root workspaces
- [ ] Test session resumption behavior
- [ ] Validate adapter compatibility
- [ ] Update monitoring to use streaming notifications

## 9. Backward Compatibility

The heartbeat API continues to work for board operations. ACP is additive for IDE-native scenarios. Both can coexist:

- Use heartbeat for scheduler-triggered runs
- Use ACP for interactive IDE sessions
- Work definitions can be created from issues
- Cost tracking works in both modes



