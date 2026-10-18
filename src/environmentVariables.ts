import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseEnv } from "node:util";
import type { QcodeSettings } from "./qcodeSettings";

/** Read on each launch without changing the extension host's environment. */
export function readEnvironmentVariables(
  settings: Pick<QcodeSettings, "environmentVariables">,
  title: string,
  cwd: string,
): Record<string, string> {
  if (!title) return {};
  const option = settings.environmentVariables.find((item) => item.title === title);
  if (!option) throw new Error(`Environment variables configuration "${title}" was not found.`);

  const filePath = resolveEnvironmentFilePath(option.value, cwd);
  try {
    // Parse data, never source a shell script or interpolate commands/variables.
    return parseEnv(fs.readFileSync(filePath, "utf8")) as Record<string, string>;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Do not include file contents or parser errors, which may contain secrets.
    throw new Error(`Unable to load environment variables from "${filePath}"${code ? ` (${code})` : ""}.`);
  }
}

export function resolveEnvironmentFilePath(value: string, cwd: string): string {
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.resolve(os.homedir(), value.slice(2));
  }
  return path.resolve(cwd, value);
}
