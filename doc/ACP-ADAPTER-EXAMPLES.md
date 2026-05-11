# ACP Adapter Examples

Status: V1 implementation guide  
Date: 2026-05-08  
Audience: Adapter developers

## 1. Minimal Adapter Stub

A minimal adapter that echoes input:

```typescript
// packages/adapters/echo-adapter/src/server/index.ts
import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  ServerAdapterModule
} from "@paperclipai/adapter-utils";

export const echoAdapter: ServerAdapterModule = {
  type: "echo_adapter",

  async execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    const prompt = ctx.context.prompt as string || "";

    // Echo the prompt back with a transformation
    await ctx.onLog("stdout", `Echo: ${prompt}\n`);

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary: `Echoed: "${prompt}"`
    };
  },

  async testEnvironment(): Promise<AdapterEnvironmentTestResult> {
    return {
      adapterType: "echo_adapter",
      status: "pass",
      checks: [{
        code: "ready",
        level: "info",
        message: "Echo adapter ready"
      }],
      testedAt: new Date().toISOString()
    };
  },

  getConfigSchema() {
    return {
      fields: [
        {
          key: "prefix",
          label: "Output Prefix",
          type: "text",
          default: "Echo:"
        }
      ]
    };
  }
};

export default echoAdapter;
```

## 2. Production-Ready Adapter Template

A complete adapter structure following Paperclip conventions:

```typescript
// packages/adapters/my-adapter/src/server/index.ts
import type {
  AdapterAgent,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterSkillContext,
  AdapterSkillSnapshot,
  AdapterConfigSchema,
  AdapterRuntimeCommandSpec,
  AdapterModel,
  ProviderQuotaResult,
  HireApprovedPayload,
  HireApprovedHookResult,
  ServerAdapterModule
} from "@paperclipai/adapter-utils";

import { execa } from "execa";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.join(os.homedir(), ".myadapter", "sessions");

// Session codec for state persistence
export const sessionCodec = {
  deserialize(raw: unknown) {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    return {
      sessionId: typeof r.sessionId === "string" ? r.sessionId : undefined,
      cwd: typeof r.cwd === "string" ? r.cwd : undefined
    };
  },
  serialize(params) {
    if (!params) return null;
    return {
      sessionId: params.sessionId,
      cwd: params.cwd
    };
  },
  getDisplayId(params) {
    return params?.sessionId ?? null;
  }
};

// Main adapter export
export const myAdapter: ServerAdapterModule = {
  type: "my_adapter",
  sessionCodec,

  async execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    const { runId, agent, config, context, onLog, onMeta, cwd } = ctx;

    // Prepare session directory
    await fs.mkdir(SESSIONS_DIR, { recursive: true });
    const sessionFile = path.join(SESSIONS_DIR, `${runId}.jsonl`);

    // Build command
    const prompt = context.prompt as string;
    const model = config.model as string || "default";

    const args = [
      "--session", sessionFile,
      "--model", model,
      "--output-format", "json"
    ];

    // Log invocation metadata
    if (onMeta) {
      await onMeta({
        adapterType: "my_adapter",
        command: "myagent",
        cwd,
        commandArgs: args,
        prompt,
        promptMetrics: { promptChars: prompt.length }
      });
    }

    // Execute agent
    const proc = await execa("myagent", args, {
      cwd,
      env: process.env,
      timeout: 300000 // 5 minutes
    }).catch((error) => ({
      exitCode: error.exitCode,
      signal: error.signal,
      timedOut: error.timedOut,
      stdout: error.stdout || "",
      stderr: error.stderr || ""
    }));

    // Parse JSONL output
    const output = parseJsonl(proc.stdout || "");
    const lastMessage = output[output.length - 1];

    return {
      exitCode: proc.exitCode ?? 0,
      signal: proc.signal,
      timedOut: proc.timedOut,
      errorMessage: proc.exitCode !== 0 ? (proc.stderr || "Unknown error") : null,
      sessionId: sessionFile,
      sessionParams: {
        sessionId: sessionFile,
        cwd
      },
      usage: {
        inputTokens: lastMessage?.usage?.inputTokens || 0,
        outputTokens: lastMessage?.usage?.outputTokens || 0,
        cachedInputTokens: lastMessage?.usage?.cachedTokens
      },
      costUsd: lastMessage?.cost || 0,
      summary: lastMessage?.content || proc.stdout,
      resultJson: output
    };
  },

  async testEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult> {
    const checks = [];

    // Check binary availability
    try {
      const result = await execa("myagent", ["--version"], { reject: false });
      if (result.exitCode === 0) {
        checks.push({
          code: "binary_found",
          level: "info",
          message: `myagent ${result.stdout?.trim()} installed`
        });
      } else {
        checks.push({
          code: "binary_not_found",
          level: "error",
          message: "myagent not found",
          hint: "Install myagent: npm install -g myagent"
        });
      }
    } catch {
      checks.push({
        code: "binary_not_found",
        level: "error",
        message: "myagent binary not available"
      });
    }

    // Check API key (if required)
    const apiKey = ctx.config.apiKey as string | undefined;
    if (apiKey && apiKey.length < 20) {
      checks.push({
        code: "api_key_invalid",
        level: "warn",
        message: "API key appears too short",
        hint: "Verify your API key configuration"
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
  },

  async listSkills(ctx: AdapterSkillContext): Promise<AdapterSkillSnapshot> {
    // Return supported skills for this adapter
    return {
      adapterType: "my_adapter",
      supported: true,
      mode: "persistent",
      desiredSkills: ["bash", "read", "write"],
      entries: [
        {
          key: "bash",
          runtimeName: "bash",
          desired: true,
          managed: false,
          state: "available",
          readOnly: false
        },
        {
          key: "read",
          runtimeName: "read-file",
          desired: true,
          managed: false,
          state: "available",
          readOnly: true
        },
        {
          key: "write",
          runtimeName: "write-file",
          desired: true,
          managed: false,
          state: "available",
          readOnly: false
        }
      ],
      warnings: []
    };
  },

  listModels(): Promise<AdapterModel[]> {
    return Promise.resolve([
      { id: "gpt-4", label: "GPT-4" },
      { id: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
      { id: "claude-3-opus", label: "Claude 3 Opus" },
      { id: "claude-3-sonnet", label: "Claude 3 Sonnet" }
    ]);
  },

  getRuntimeCommandSpec() {
    return {
      command: "myagent",
      detectCommand: "myagent --version",
      installCommand: "curl -fsSL https://install.myagent.com | sh"
    };
  },

  getConfigSchema(): AdapterConfigSchema {
    return {
      fields: [
        {
          key: "model",
          label: "Model",
          type: "select",
          options: [
            { label: "GPT-4", value: "gpt-4" },
            { label: "GPT-3.5 Turbo", value: "gpt-3.5-turbo" },
            { label: "Claude 3 Opus", value: "claude-3-opus" },
            { label: "Claude 3 Sonnet", value: "claude-3-sonnet" }
          ],
          default: "gpt-4",
          group: "Model"
        },
        {
          key: "apiKey",
          label: "API Key",
          type: "text",
          hint: "Your myagent API key",
          required: true,
          group: "Authentication"
        },
        {
          key: "maxTokens",
          label: "Max Tokens",
          type: "number",
          default: 4096,
          hint: "Maximum tokens in response",
          group: "Model"
        },
        {
          key: "temperature",
          label: "Temperature",
          type: "number",
          default: 0.7,
          hint: "Sampling temperature (0-2)",
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
  },

  async onHireApproved(payload: HireApprovedPayload, adapterConfig: Record<string, unknown>): Promise<HireApprovedHookResult> {
    // Optional: Send notification when agent is approved
    const callbackUrl = adapterConfig.callbackUrl as string | undefined;
    if (callbackUrl) {
      try {
        await fetch(callbackUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "agent_hired",
            ...payload
          })
        });
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    }
    return { ok: true };
  },

  async getQuotaWindows(): Promise<ProviderQuotaResult> {
    // Optional: Report provider quota status
    return {
      ok: true,
      provider: "myagent",
      source: "api",
      windows: [
        {
          label: "Daily",
          usedPercent: 45,
          resetsAt: new Date(Date.now() + 86400000).toISOString(),
          valueLabel: "$10.50 remaining",
          detail: "24-hour rolling window"
        },
        {
          label: "Monthly",
          usedPercent: 67,
          resetsAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(),
          valueLabel: "$150.00 remaining"
        }
      ]
    };
  },

  supportsInstructionsBundle: true,
  supportsLocalAgentJwt: true
};

// Helper to parse JSONL output
function parseJsonl(text: string): unknown[] {
  return text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });
}