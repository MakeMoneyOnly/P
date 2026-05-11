# @paperclipai/adapter-vscode-ide

VS Code IDE Adapter for ACP (Agent Client Protocol)

This package provides the VS Code extension side of ACP integration, enabling VS Code and its forks (Cursor, Windsurf, VSCodium, etc.) to participate in Paperclip's Agent Client Protocol.

## Purpose

Unlike traditional Paperclip agent adapters (which are server-side and execute agent CLIs), this adapter is a **client library** meant to be bundled into VS Code extensions. It enables:

- **IDE Execution Mode**: Paperclip can dispatch tasks to VS Code for local execution
- **File Change Notifications**: Real-time file system events synced to the workspace daemon
- **Session Management**: IDE clients can establish ACP sessions with the workspace daemon

## Usage

Add this to your VS Code extension's dependencies:

```bash
npm install @paperclipai/acp-client @paperclipai/acp-types
```

Then use in your extension's activation:

```typescript
import { activateAcpExtension } from '@paperclipai/adapter-vscode-ide/extension';

export function activate(context: vscode.ExtensionContext) {
  const manager = activateAcpExtension(context);
  // The manager handles ACP communication automatically
}
```

## API

### `VscodeIdeAdapter` (main entry)

A class that wraps `AcpClient` for IDE integration.

```typescript
import { VscodeIdeAdapter } from '@paperclipai/adapter-vscode-ide';

const adapter = new VscodeIdeAdapter({
  daemonUrl: 'ws://localhost:3100/ws',
  authToken: 'optional-token',
});

await adapter.initialize({
  workspaceFolders: [vscode.workspace.rootPath],
  extensionContext: context,
  vscode, // VS Code API
});

// Initialize session
const sessionId = await adapter.initializeSession('vscode-ide', '/path/to/workspace');
```

### `activateAcpExtension` (extension entry)

Convenience function for VS Code extension activation.

```typescript
import { activateAcpExtension } from '@paperclipai/adapter-vscode-ide/extension';

export function activate(context: vscode.ExtensionContext) {
  return activateAcpExtension(context);
}
```

## IDE Execution Flow

1. Paperclip server creates a task with `agent.runInIde`
2. Workspace daemon sends `task.executeRequest` notification to connected IDEs
3. VS Code extension receives the workSpec and executes it locally
4. Extension calls `sendExecuteResult` to report results back

## Compatibility

- VS Code 1.70+
- Compatible with VS Code forks: Cursor, Windsurf, VSCodium, etc.
- Requires Paperclip server with ACP support (port 3100 WebSocket endpoint)

## See Also

- [ACP Types](../acp-types/) - JSON-RPC 2.0 message types
- [ACP Client](../acp-client/) - IDE-side client library