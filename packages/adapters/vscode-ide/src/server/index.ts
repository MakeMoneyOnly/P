import type {
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterSessionCodec,
} from "@paperclipai/adapter-utils";

export const type = "vscode_ide";
export const label = "VS Code IDE";

function summarizeCheck(checks: AdapterEnvironmentTestResult["checks"]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((c) => c.level === "error")) return "fail";
  if (checks.some((c) => c.level === "warn")) return "warn";
  return "pass";
}

export async function testEnvironment(
  _ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];

  checks.push({
    code: "vscode_ide_mode",
    level: "info",
    message: "VS Code IDE adapter operates in IDE execution mode",
    hint: "The IDE (VS Code, Cursor, Windsurf) must be running and have the ACP extension installed",
  });

  checks.push({
    code: "vscode_acp_extension",
    level: "info",
    message: "VS Code ACP extension provides the workspace daemon connection",
    detail: "Install the Paperclip extension in VS Code to enable IDE execution",
  });

  return {
    adapterType: "vscode_ide",
    status: summarizeCheck(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}

interface AdapterEnvironmentCheck {
  code: string;
  level: "info" | "warn" | "error";
  message: string;
  detail?: string;
  hint?: string;
}

export async function execute(
  ctx: AdapterExecutionContext,
): Promise<AdapterExecutionResult> {
  const { onLog } = ctx;

  await onLog("stdout", "[paperclip] VS Code IDE adapter: delegating to connected IDE via ACP\n");

  await onLog(
    "stdout",
    "[paperclip] The IDE execution mode requires:\n" +
      "  1. VS Code (or fork) running with the Paperclip ACP extension\n" +
      "  2. The IDE connected to this workspace daemon\n" +
      "  3. Tasks are dispatched via ACP for local IDE execution\n",
  );

  return {
    exitCode: 0,
    stdout: "VS Code IDE adapter ready for ACP-based IDE execution",
    stderr: "",
    summary: "IDE execution mode - tasks dispatched to connected VS Code instance",
  };
}

export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw: unknown) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const sessionId = typeof record.sessionId === "string" ? record.sessionId : null;
    return sessionId ? { sessionId, ideMode: true } : null;
  },
  serialize(params: Record<string, unknown> | null) {
    if (!params) return null;
    return { sessionId: params.sessionId as string };
  },
  getDisplayId(params) {
    return params?.sessionId as string | null;
  },
};

export const agentConfigurationDoc = `# vscode_ide agent configuration

Adapter: vscode_ide

Use when:
- You want Paperclip to dispatch tasks to VS Code as an IDE (not as an agent)
- You want tasks to be executed locally in VS Code
- You want Cursor, Windsurf, or other VS Code forks to participate in agent workflow
- You want file change notifications in the workspace daemon

Don't use when:
- You want to run an external agent CLI locally (use claude_local, cursor, etc.)
- You want to run agent tasks on remote infrastructure

Setup:
1. Install the Paperclip extension in VS Code (or compatible fork)
2. The extension connects to the workspace daemon automatically
3. Create a vscode_ide agent in Paperclip
4. Tasks will be dispatched to VS Code for local execution

Core fields:
- No required configuration fields - the IDE extension handles daemon connection

IDE Execution Mode:
- Tasks created with this agent are dispatched to VS Code via ACP
- The IDE receives the workSpec and executes it locally
- Results are reported back to Paperclip through the ACP connection
- This enables Paperclip to delegate work to the IDE's local environment

Notes:
- Compatible with VS Code and forks (Cursor, Windsurf, VSCodium, etc.)
- Requires the Paperclip extension to be installed and connected
- The IDE must be running for task execution
`;

export function createServerAdapter() {
  return {
    type: "vscode_ide" as const,
    execute,
    testEnvironment,
    sessionCodec,
    agentConfigurationDoc,
    supportsLocalAgentJwt: false,
    supportsInstructionsBundle: false,
  };
}