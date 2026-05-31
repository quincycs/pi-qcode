import * as path from "node:path";
import * as vscode from "vscode";

export interface FileSuggestion {
  path: string;
  label: string;
  description: string;
}

interface CandidateFile {
  path: string;
  label: string;
}

const maxCandidateFiles = 5000;
const defaultLimit = 20;
const cacheTtlMs = 10_000;
const excludePattern = "**/{node_modules,.git,.github,out,dist,__pycache__,.venv,.env,venv,env,.cache,tmp,temp}/**";

let fileCache:
  | { workspaceKey: string; createdAt: number; files: CandidateFile[] }
  | undefined;

export async function searchFileSuggestions(
  query: string,
  limit = defaultLimit,
): Promise<FileSuggestion[]> {
  const files = await getWorkspaceFiles();
  const normalizedQuery = query.trim().toLowerCase();

  const ranked = files
    .map((file, index) => ({ file, index, score: scoreFile(file, normalizedQuery) }))
    .filter((result) => result.score !== Number.POSITIVE_INFINITY)
    .sort((a, b) => a.score - b.score || a.file.path.length - b.file.path.length || a.index - b.index)
    .slice(0, limit);

  return ranked.map(({ file }) => ({
    path: file.path,
    label: file.label,
    description: file.path,
  }));
}

async function getWorkspaceFiles(): Promise<CandidateFile[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.length) return [];

  const workspaceKey = workspaceFolders.map((folder) => folder.uri.toString()).join("|");
  if (
    fileCache &&
    fileCache.workspaceKey === workspaceKey &&
    Date.now() - fileCache.createdAt < cacheTtlMs
  ) {
    return fileCache.files;
  }

  const uris = await vscode.workspace.findFiles(
    "**/*",
    excludePattern,
    maxCandidateFiles,
  );

  const activeFiles = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .map((tab) => getTabUri(tab))
    .filter(
      (uri): uri is vscode.Uri =>
        uri !== undefined &&
        uri.scheme === "file" &&
        vscode.workspace.getWorkspaceFolder(uri) !== undefined,
    );

  const seen = new Set<string>();
  const orderedUris = [...activeFiles, ...uris].filter((uri) => {
    const key = uri.toString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const files = orderedUris.map((uri) => {
    const relativePath = vscode.workspace.asRelativePath(uri, false).split(path.sep).join("/");
    return {
      path: relativePath,
      label: path.posix.basename(relativePath),
    };
  });

  fileCache = { workspaceKey, createdAt: Date.now(), files };
  return files;
}

function getTabUri(tab: vscode.Tab): vscode.Uri | undefined {
  const input = tab.input;
  if (input instanceof vscode.TabInputText) return input.uri;
  if (input instanceof vscode.TabInputTextDiff) return input.modified;
  if (input instanceof vscode.TabInputNotebook) return input.uri;
  if (input instanceof vscode.TabInputNotebookDiff) return input.modified;
  return undefined;
}

function scoreFile(file: CandidateFile, query: string): number {
  if (!query) return 0;

  const label = file.label.toLowerCase();
  const filePath = file.path.toLowerCase();

  if (label === query) return 0;
  if (label.startsWith(query)) return 1;
  if (filePath.startsWith(query)) return 2;
  if (label.includes(query)) return 3 + label.indexOf(query) / 100;
  if (filePath.includes(query)) return 4 + filePath.indexOf(query) / 1000;

  const fuzzyScore = fuzzyMatchScore(filePath, query);
  if (fuzzyScore === undefined) return Number.POSITIVE_INFINITY;
  return 10 + fuzzyScore;
}

function fuzzyMatchScore(value: string, query: string): number | undefined {
  let queryIndex = 0;
  let score = 0;
  let lastMatchIndex = -1;

  for (let valueIndex = 0; valueIndex < value.length && queryIndex < query.length; valueIndex++) {
    if (value[valueIndex] !== query[queryIndex]) continue;

    if (lastMatchIndex >= 0) score += valueIndex - lastMatchIndex - 1;
    lastMatchIndex = valueIndex;
    queryIndex++;
  }

  return queryIndex === query.length ? score : undefined;
}
