import type { UIAdapterModule } from "../types";
import { SchemaConfigFields, buildSchemaAdapterConfig } from "../schema-config-fields";
import { parseProcessStdoutLine } from "../process/parse-stdout";

/**
 * VS Code IDE adapter - connects to VS Code via ACP for IDE execution mode.
 * Tasks are dispatched to VS Code for local execution instead of spawning a subprocess.
 */
export const vscodeIdeUIAdapter: UIAdapterModule = {
  type: "vscode_ide",
  label: "VS Code IDE",
  parseStdoutLine: parseProcessStdoutLine,
  ConfigFields: SchemaConfigFields,
  buildAdapterConfig: buildSchemaAdapterConfig,
};