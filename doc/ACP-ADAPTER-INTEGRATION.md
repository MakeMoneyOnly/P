# ACP Adapter Integration Guide

Status: V1 implementation guide  
Date: 2026-05-08  
Audience: Adapter developers, plugin authors

## 1. Overview

ACP adapters connect the workspace daemon to specific agent implementations (Pi, OpenCode, Cursor, etc.). This guide covers implementing the `ServerAdapterModule` interface for ACP.

## 2. Adapter Interface

Every ACP adapter must implement `ServerAdapterModule`:

```typescript
interface ServerAdapterModule {
  // Required methods
  type: string;
  execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult>;
  testEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult>;

  // Optional methods
  listSkills?: (ctx: AdapterSkillContext) => Promise<AdapterSkillSnapshot>;
  syncSkills?: (ctx: AdapterSkillContext, desiredSkills: string[]) => Promise<AdapterSkillSnapshot>;
  sessionCodec?: AdapterSessionCodec;
  sessionManagement?: SessionManagementSpec;
  supportsLocalAgentJwt?: boolean;
  models?: AdapterModel[];
  listModels?: () => Promise<AdapterModel[]>;
  modelProfiles?: AdapterModelProfileDefinition[];
  listModelProfiles?: () => Promise<AdapterModelProfileDefinition[]>;
  refreshModels?: () => Promise<AdapterModel[]>;
  agentConfigurationDoc?: string;
  onHireApproved?: (payload: HireApprovedPayload, adapterConfig: Record<string, unknown>) => Promise<HireApprovedHookResult>;
  getQuotaWindows?: () => Promise<ProviderQuotaResult>;
  detectModel?: () => Promise<{ model: string; provider: string; source: string; candidates?: string[] } | null>;
  getConfigSchema?: () => Promise<AdapterConfigSchema> | AdapterConfigSchema;

  // Capability flags
  supportsInstructionsBundle?: boolean;
  instructionsPathKey?: string;
  requiresMaterializedRuntimeSkills?: boolean;
  getRuntimeCommandSpec?: (config: Record<string, unknown>) => AdapterRuntimeCommandSpec | null;
}
```

## 3. Execution Context

The `AdapterExecutionContext` provides all necessary context for execution:

```typescript
interface AdapterExecutionContext {
  runId: string;                        // Unique execution identifier
  agent: AdapterAgent;                  // Agent identity
  runtime: AdapterRuntime;              // Runtime/session info
  config: Record<string, unknown>;      // Agent adapter configuration
  context: Record<string, unknown>;     // Execution context (prompt, workSpec, etc.)
  runtimeCommandSpec?: AdapterRuntimeCommandSpec | null;
  executionTarget?: AdapterExecutionTarget | null;
  executionTransport?: { remoteExecution?: Record<string, unknown> | null };
  onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
  onMeta?: (meta: AdapterInvocationMeta) => Promise<void>;
  onSpawn?: (meta: { pid: number; processGroupId: number | null; startedAt: string }) => Promise<void>;
  authToken?: string;
}
```

## 4. Implement the execute Method

The `execute` method spawns the agent process and returns results:

```typescript
async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta } = ctx;

  // Build working directory
  const cwd = config.cwd as string || process.cwd();

  // Build environment variables
  const env = {
    ...process.env,
    ...buildPaperclipEnv(agent),
    PAPERCLIP_RUN_ID: runId,
  };

  // Extract prompt from context
  const prompt = context.prompt as string;

  // Build command arguments
  const args = [
    "--mode", "json",
    "-p", prompt,
    "--session", sessionFile
  ];

  // Log invocation metadata if handler provided
  if (onMeta) {
    await onMeta({
      adapterType: "my_adapter",
      command: "my-agent",
      cwd,
      commandArgs: args,
      env,
      prompt,
      promptMetrics: { promptChars: prompt.length },
      context
    });
  }

  // Execute the agent process
  const proc = await runAdapterExecutionTargetProcess(
    runId,
    executionTarget,
    "my-agent",
    args,
    { cwd, env, onLog }
  );

  // Parse output and build result
  return {
    exitCode: proc.exitCode,
    signal: proc.signal,
    timedOut: proc.timedOut,
    errorMessage: proc.exitCode !== 0 ? "Command failed" : null,
    usage: {
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      cachedInputTokens: parsed.cachedTokens
    },
    sessionId: sessionPath,
    provider: "my-provider",
    model: config.model as string,
    costUsd: parsed.costUsd
  };
}
```

## 5. Streaming Output

Use `onLog` to stream output to the IDE:

```typescript
const proc = await runAdapterExecutionTargetProcess(runId, target, command, args, {
  cwd,
  env,
  onLog: async (stream, chunk) => {
    // Stream stdout/stderr to IDE
    await onLog(stream, chunk);

    // Buffer and parse structured output
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        // Parse JSONL or other structured format
        const parsed = parseOutput(line);
        if (parsed.type === 'error') {
          await onLog('stderr', `[${parsed.code}] ${parsed.message}\n`);
        }
      }
    }
  }
});
```

## 6. JSON-RPC Method Handlers

When the workspace daemon receives a JSON-RPC request, it routes to adapter methods:

```typescript
// In workspace-daemon.ts
private handleRpcMessage: RpcHandler = async (message, ws, _sessionId) => {
  switch (message.method) {
    case "agent.execute": {
      const ctx: AdapterExecutionContext = {
        runId: generateRunId(),
        agent: {
          id: session.agentId,
          companyId: this.config.companyId || "default",
          name: session.agentId,
          adapterType: this.config.adapter!.type,
          adapterConfig: {}
        },
        runtime: {
          sessionId: session.id,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null
        },
        config: agentConfig,
        context: { prompt: message.params.prompt, workSpec: message.params.workSpec },
        onLog: async (stream, chunk) => this.streamOutput(sessionId, stream, chunk)
      };

      const result = await this.config.adapter!.execute(ctx);
      // ... handle result
      break;
    }
  }
};
```

## 7. Session Management

### 7.1 Session Params

The `runtime.sessionParams` contains session persistence data:

```typescript
// Session codec for serializing/deserializing session state
const sessionCodec: AdapterSessionCodec = {
  deserialize(raw: unknown) {
    if (typeof raw !== 'object' || raw === null) return null;
    return {
      sessionId: raw.sessionId as string,
      cwd: raw.cwd as string
    };
  },
  serialize(params) {
    return params ? { sessionId: params.sessionId, cwd: params.cwd } : null;
  },
  getDisplayId(params) {
    return params?.sessionId ?? null;
  }
};
```

### 7.2 Returning Session State

Return session information to enable resumption:

```typescript
return {
  exitCode: 0,
  timedOut: false,
  sessionId: sessionPath,
  sessionParams: {
    sessionId: sessionPath,
    cwd: effectiveCwd,
    workspaceId: context.workspaceId
  },
  sessionDisplayId: path.basename(sessionPath, '.jsonl')
};
```

## 8. Notification Streaming

The adapter returns results, and the daemon sends notifications:

```typescript
// After agent execution, daemon sends:
this.server.sendNotificationToSession(sessionId, "agent.output", {
  sessionId,
  type: "stdout",
  data: line + "\n"
});

// On completion:
this.server.sendNotificationToSession(sessionId, "agent.output", {
  sessionId,
  type: "result",
  data: result.summary || "Execution completed"
});

// On error:
this.server.sendNotificationToSession(sessionId, "agent.error", {
  sessionId,
  error: { code: -32000, message: errorMessage }
});
```

## 9. Environment Test

Implement environment testing for diagnostics:

```typescript
async function testEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];

  // Check if agent binary is available
  try {
    const proc = await execa("my-agent", ["--version"], { reject: false });
    if (proc.exitCode === 0) {
      checks.push({
        code: "binary_available",
        level: "info",
        message: `my-agent ${proc.stdout?.trim()} available`
      });
    } else {
      checks.push({
        code: "binary_missing",
        level: "error",
        message: "my-agent not found in PATH",
        hint: "Install my-agent or add to PATH"
      });
    }
  } catch {
    checks.push({
      code: "binary_missing",
      level: "error",
      message: "my-agent not installed"
    });
  }

  // Check for required configuration
  if (!ctx.config.apiKey) {
    checks.push({
      code: "api_key_missing",
      level: "error",
      message: "API key not configured",
      hint: "Add apiKey to adapter config"
    });
  }

  const status = checks.some(c => c.level === "error") ? "fail" :
                 checks.some(c => c.level === "warn") ? "warn" : "pass";

  return {
    adapterType: "my_adapter",
    status,
    checks,
    testedAt: new Date().toISOString()
  };
}
```

## 10. Configuration Schema

Provide a declarative config schema for dynamic UI forms:

```typescript
function getConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: "model",
        label: "Model",
        type: "select",
        options: [
          { label: "GPT-4", value: "gpt-4" },
          { label: "GPT-3.5 Turbo", value: "gpt-3.5-turbo" }
        ],
        default: "gpt-4",
        group: "Model"
      },
      {
        key: "maxTokens",
        label: "Max Tokens",
        type: "number",
        default: 4096,
        group: "Model"
      },
      {
        key: "instructionsFilePath",
        label: "Instructions File",
        type: "text",
        hint: "Path to AGENTS.md file",
        group: "Agent"
      }
    ]
  };
}
```

## 11. Complete Adapter Example

See `packages/adapters/pi-local/src/server/index.ts` for a full implementation:

```typescript
// packages/adapters/my-adapter/src/server/index.ts
import type { ServerAdapterModule } from "@paperclipai/adapter-utils";

export const myAdapter: ServerAdapterModule = {
  type: "my_adapter",

  async execute(ctx) {
    // Implementation
  },

  async testEnvironment(ctx) {
    // Implementation
  },

  getConfigSchema() {
    return {
      fields: [
        // ... config fields
      ]
    };
  },

  getRuntimeCommandSpec(config) {
    return {
      command: "my-agent",
      detectCommand: "my-agent --version"
    };
  },

  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath"
};
```

## 12. Registering the Adapter

Configure the daemon with your adapter:

```typescript
import { WorkspaceDaemon } from "@paperclipai/acp-server";
import { myAdapter } from "./my-adapter";

const daemon = new WorkspaceDaemon({
  workspacePath: "/path/to/workspace",
  adapter: myAdapter,
  companyId: "company-123"
});

await daemon.start();
```
