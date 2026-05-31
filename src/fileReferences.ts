import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

interface ParsedFileReference {
  pathText: string;
  line?: number;
  column?: number;
}

interface ResolvedFileReference {
  uri: vscode.Uri;
  line?: number;
  column?: number;
}

export async function openFileReference(value: string): Promise<void> {
  const resolved = await resolveFileReference(value);
  if (!resolved) {
    vscode.window.showWarningMessage(`Unable to find file: ${value}`);
    return;
  }

  const document = await vscode.workspace.openTextDocument(resolved.uri);
  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
  });

  if (resolved.line !== undefined) {
    const line = Math.max(0, Math.min(resolved.line, document.lineCount - 1));
    const maxColumn = document.lineAt(line).text.length;
    const column = Math.max(0, Math.min(resolved.column ?? 0, maxColumn));
    const position = new vscode.Position(line, column);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }
}

export async function openExternalUrl(value: string): Promise<void> {
  if (!/^https?:\/\//i.test(value)) return;
  await vscode.env.openExternal(vscode.Uri.parse(value));
}

export async function fileReferenceExists(value: string): Promise<boolean> {
  const parsed = parseFileReference(value);
  if (!parsed) return false;
  if (resolveDirectFilePath(parsed.pathText)) return true;
  return (await findWorkspaceFileCandidates(parsed.pathText)).length > 0;
}

async function resolveFileReference(value: string): Promise<ResolvedFileReference | undefined> {
  const parsed = parseFileReference(value);
  if (!parsed) return undefined;

  const directPath = resolveDirectFilePath(parsed.pathText);
  if (directPath) {
    return { uri: vscode.Uri.file(directPath), line: parsed.line, column: parsed.column };
  }

  const discovered = await pickWorkspaceFile(parsed.pathText);
  return discovered
    ? { uri: discovered, line: parsed.line, column: parsed.column }
    : undefined;
}

function parseFileReference(value: string): ParsedFileReference | undefined {
  let text = value.trim();
  if (!text) return undefined;

  if (text.startsWith("file://")) {
    try {
      text = vscode.Uri.parse(text).fsPath;
    } catch {
      // Fall back to the original text.
    }
  }

  text = text
    .replace(/^@/, "")
    .replace(/^`|`$/g, "")
    .replace(/^<|>$/g, "")
    .trim();

  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1);
  }

  text = text.replace(/[),.;!?]+$/g, "");

  let line: number | undefined;
  let column: number | undefined;

  const hashLineMatch = text.match(/#L(\d+)(?:C(\d+))?$/i);
  if (hashLineMatch) {
    line = Number(hashLineMatch[1]) - 1;
    column = hashLineMatch[2] ? Number(hashLineMatch[2]) - 1 : undefined;
    text = text.slice(0, hashLineMatch.index).trim();
  } else {
    const colonLineMatch = text.match(/^(.*):(\d+)(?::(\d+))$/) ?? text.match(/^(.*):(\d+)$/);
    if (colonLineMatch && colonLineMatch[1] && !/^[A-Za-z]$/.test(colonLineMatch[1])) {
      line = Number(colonLineMatch[2]) - 1;
      column = colonLineMatch[3] ? Number(colonLineMatch[3]) - 1 : undefined;
      text = colonLineMatch[1].trim();
    }
  }

  text = text.replace(/^~(?=$|[\/])/, process.env.HOME || "");
  return text ? { pathText: text, line, column } : undefined;
}

function resolveDirectFilePath(fileReference: string): string | undefined {
  const candidatePaths = new Set<string>();
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

  if (path.isAbsolute(fileReference)) {
    candidatePaths.add(fileReference);
  }

  for (const folder of workspaceFolders) {
    candidatePaths.add(path.resolve(folder.uri.fsPath, fileReference));
  }

  for (const candidatePath of candidatePaths) {
    if (isReadableFile(candidatePath)) return candidatePath;
  }

  return undefined;
}

async function pickWorkspaceFile(fileReference: string): Promise<vscode.Uri | undefined> {
  const candidates = await findWorkspaceFileCandidates(fileReference);

  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  const picked = await vscode.window.showQuickPick(
    candidates.map((uri) => ({
      label: vscode.workspace.asRelativePath(uri, false),
      description: uri.fsPath,
      uri,
    })),
    { placeHolder: `Open ${fileReference}` },
  );

  return picked?.uri;
}

async function findWorkspaceFileCandidates(fileReference: string): Promise<vscode.Uri[]> {
  if (!vscode.workspace.workspaceFolders?.length) return [];

  const normalizedReference = normalizePathForMatch(fileReference);
  const basename = path.basename(normalizedReference);
  if (!basename || basename === "." || basename === path.sep) return [];

  const matches = await vscode.workspace.findFiles(
    `**/${basename}`,
    "**/{.git,node_modules,dist,out,build,.next}/**",
    100,
  );
  const exactSuffixMatches = matches.filter((uri) =>
    normalizePathForMatch(uri.fsPath).endsWith(normalizedReference),
  );
  return exactSuffixMatches.length ? exactSuffixMatches : matches;
}

function normalizePathForMatch(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

function isReadableFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
