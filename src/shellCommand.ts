export type TerminalShellKind = "posix" | "powershell";

export interface TerminalShellConfiguration {
  kind: TerminalShellKind;
  shellPath?: string;
}

export function resolveTerminalShell(
  shellPath: string | undefined,
  platform = process.platform,
): TerminalShellConfiguration {
  const shell = (shellPath || "").toLowerCase().replace(/\\/g, "/");
  if (/(?:^|\/)(?:pwsh|powershell)(?:\.exe)?$/.test(shell))
    return { kind: "powershell" };
  // cmd.exe cannot safely quote every possible prompt (notably %, !, and newlines).
  // Use the Windows-provided PowerShell instead of interpolating into Command Prompt.
  if (/(?:^|\/)cmd(?:\.exe)?$/.test(shell) || (platform === "win32" && !shell))
    return { kind: "powershell", shellPath: "powershell.exe" };
  return { kind: "posix" };
}

export function prepareTerminalArgument(value: string): string {
  // Pi treats a leading @ as a file attachment; preserve qcode's positional prompt workaround.
  return value.startsWith("@") ? ` ${value}` : value;
}

export function quoteTerminalArgument(value: string, shell: TerminalShellKind): string {
  const argument = prepareTerminalArgument(value);
  if (shell === "powershell") return `'${argument.replace(/'/g, "''")}'`;
  return `'${argument.replace(/'/g, `'\\''`)}'`;
}

export function buildTerminalCommand(executable: string, args: string[], shell: TerminalShellKind): string {
  return [quoteExecutable(executable, shell), ...args.map((arg) => quoteTerminalArgument(arg, shell))].join(" ");
}

export function splitCliArgs(value: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let escaping = false;
  for (const character of value.trim()) {
    if (escaping) { current += character; escaping = false; continue; }
    if (character === "\\" && quote !== "'") { escaping = true; continue; }
    if ((character === '"' || character === "'") && (!quote || quote === character)) {
      quote = quote ? undefined : character;
      continue;
    }
    if (/\s/.test(character) && !quote) {
      if (current) { args.push(current); current = ""; }
      continue;
    }
    current += character;
  }
  if (escaping) current += "\\";
  if (current) args.push(current);
  return args;
}

export function usesOpenAiCodexModelProvider(providerArgs: string[]): boolean {
  return providerArgs.some((arg, index) =>
    (arg === "--model" && providerArgs[index + 1]?.startsWith("openai-codex/")) ||
    arg.startsWith("--model=openai-codex/"),
  );
}

function quoteExecutable(executable: string, shell: TerminalShellKind): string {
  return /\s|['"]/.test(executable) ? quoteTerminalArgument(executable, shell) : executable;
}
