import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";

export interface HashAutocompleteOption {
  command: string;
  value: string;
}

export interface ProviderOption {
  nickname: string;
  cliArgs: string;
  environmentVariables?: string;
}

export interface EnvironmentVariablesOption {
  title: string;
  value: string;
}

export interface PinnedSessionSetting {
  filePath: string;
  pinnedAt: number;
}

export interface FolderSetting {
  path: string;
  pinned: PinnedSessionSetting[];
}

export interface SlackShareSettings {
  enabled: boolean;
  userToken: string;
  botToken: string;
  channelId: string;
}

export interface SlackShareThread {
  sessionFile: string;
  channelId: string;
  threadTs: string;
}

export interface QcodeSettings {
  slackShare: SlackShareSettings;
  slackShareThreads: SlackShareThread[];
  hashAutocompleteOptions: HashAutocompleteOption[];
  providerOptions: ProviderOption[];
  environmentVariables: EnvironmentVariablesOption[];
  lastUsedProviderNickname: string;
  assistantSoundEnabled: boolean;
  assistantSoundPath: string;
  dismissedWhatsNewVersions: string[];
  folderSettings: FolderSetting[];
}

const settingsDirectory = path.join(os.homedir(), ".pi", "qcode");
const settingsFilePath = path.join(settingsDirectory, "settings.json");

export function getSettingsFilePath(): string {
  return settingsFilePath;
}

export function readQcodeSettings(filePath = settingsFilePath): QcodeSettings {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return normalizeSettings(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("Unable to read pi-qcode settings:", error);
    }
    return {
      slackShare: normalizeSlackShare(undefined),
      slackShareThreads: [],
      hashAutocompleteOptions: [],
      providerOptions: [],
      environmentVariables: [],
      lastUsedProviderNickname: "",
      assistantSoundEnabled: false,
      assistantSoundPath: "",
      dismissedWhatsNewVersions: [],
      folderSettings: [],
    };
  }
}

// Serialize read/modify/write operations, including background Slack thread saves.
const settingsWrites = new Map<string, Promise<unknown>>();
function queueSettingsWrite<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = settingsWrites.get(filePath) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  settingsWrites.set(filePath, next);
  void next.finally(() => {
    if (settingsWrites.get(filePath) === next) settingsWrites.delete(filePath);
  }).catch(() => {});
  return next;
}

export function writeQcodeSettings(
  settings: unknown,
  filePath = settingsFilePath,
): Promise<QcodeSettings> {
  return queueSettingsWrite(filePath, () => writeSettings(settings, filePath));
}

export function saveSlackShareThread(
  thread: SlackShareThread,
  filePath = settingsFilePath,
): Promise<void> {
  return queueSettingsWrite(filePath, async () => {
    const settings = readQcodeSettings(filePath);
    settings.slackShareThreads = settings.slackShareThreads.filter(
      (item) => item.sessionFile !== thread.sessionFile,
    );
    settings.slackShareThreads.push(thread);
    await writeSettings(settings, filePath);
  });
}

async function writeSettings(settings: unknown, filePath: string): Promise<QcodeSettings> {
  const record = settings && typeof settings === "object"
    ? settings as Record<string, unknown>
    : {};
  const normalized = normalizeSettings(settings);
  const existingSettings = readQcodeSettings(filePath);
  // Thread roots are immutable. Other settings writers may carry a stale copy of
  // this internal list; never let a pin/provider/dismissal save erase a new root.
  normalized.slackShareThreads = [...new Map(
    [...normalized.slackShareThreads, ...existingSettings.slackShareThreads]
      .map((thread) => [thread.sessionFile, thread] as const),
  ).values()];

  // The settings UI does not edit internal state, so preserve it when omitted.
  if (
    !Object.prototype.hasOwnProperty.call(record, "dismissedWhatsNewVersions") ||
    !Object.prototype.hasOwnProperty.call(record, "folderSettings")
  ) {
    if (!Object.prototype.hasOwnProperty.call(record, "dismissedWhatsNewVersions")) {
      normalized.dismissedWhatsNewVersions =
        existingSettings.dismissedWhatsNewVersions;
    }
    if (!Object.prototype.hasOwnProperty.call(record, "folderSettings")) {
      normalized.folderSettings = existingSettings.folderSettings;
    }
  }

  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(
      temporaryPath,
      `${JSON.stringify(normalized, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    await fs.promises.rename(temporaryPath, filePath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
  }
  return normalized;
}

export async function dismissWhatsNewVersion(
  version: string,
  filePath = settingsFilePath,
): Promise<QcodeSettings> {
  const normalizedVersion = version.trim();
  const settings = readQcodeSettings(filePath);
  if (
    !normalizedVersion ||
    settings.dismissedWhatsNewVersions.includes(normalizedVersion)
  ) {
    return settings;
  }

  return writeQcodeSettings({
    ...settings,
    dismissedWhatsNewVersions: [
      ...settings.dismissedWhatsNewVersions,
      normalizedVersion,
    ],
  }, filePath);
}

function normalizeSettings(value: unknown): QcodeSettings {
  const record = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};

  const hashAutocompleteOptions = Array.isArray(record.hashAutocompleteOptions)
    ? record.hashAutocompleteOptions.flatMap(normalizeHashAutocompleteOption)
    : [];

  const providerOptions = Array.isArray(record.providerOptions)
    ? record.providerOptions.flatMap(normalizeProviderOption)
    : [];

  const environmentVariables = Array.isArray(record.environmentVariables)
    ? record.environmentVariables.flatMap(normalizeEnvironmentVariablesOption)
    : [];

  const lastUsedProviderNickname = typeof record.lastUsedProviderNickname === "string"
    ? record.lastUsedProviderNickname.trim()
    : "";

  const assistantSoundEnabled = record.assistantSoundEnabled === true;

  const assistantSoundPath = typeof record.assistantSoundPath === "string"
    ? record.assistantSoundPath.trim()
    : "";

  const dismissedWhatsNewVersions = Array.isArray(
    record.dismissedWhatsNewVersions,
  )
    ? [
        ...new Set(
          record.dismissedWhatsNewVersions
            .filter((version): version is string => typeof version === "string")
            .map((version) => version.trim())
            .filter(Boolean),
        ),
      ]
    : [];

  const folderSettings = Array.isArray(record.folderSettings)
    ? record.folderSettings.flatMap(normalizeFolderSetting)
    : [];

  return {
    slackShare: normalizeSlackShare(record.slackShare),
    slackShareThreads: Array.isArray(record.slackShareThreads)
      ? record.slackShareThreads.flatMap((item): SlackShareThread[] => {
          if (!item || typeof item !== "object") return [];
          const { sessionFile, channelId, threadTs } = item;
          return typeof sessionFile === "string" && sessionFile &&
            typeof channelId === "string" && channelId &&
            typeof threadTs === "string" && /^\d+\.\d+$/.test(threadTs)
            ? [{ sessionFile, channelId, threadTs }] : [];
        })
      : [],
    hashAutocompleteOptions,
    providerOptions,
    environmentVariables,
    lastUsedProviderNickname,
    assistantSoundEnabled,
    assistantSoundPath,
    dismissedWhatsNewVersions,
    folderSettings,
  };
}

function normalizeSlackShare(value: unknown): SlackShareSettings {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (key: string) => typeof record[key] === "string" ? record[key].trim() : "";
  return {
    enabled: record.enabled === true,
    userToken: text("userToken"),
    botToken: text("botToken"),
    channelId: text("channelId"),
  };
}

function normalizeFolderSetting(item: unknown): FolderSetting[] {
  if (!item || typeof item !== "object") return [];

  const record = item as Record<string, unknown>;
  const folderPath = typeof record.path === "string" ? record.path.trim() : "";
  if (!folderPath) return [];

  const pinned = Array.isArray(record.pinned)
    ? record.pinned.flatMap(normalizePinnedSessionSetting)
    : [];

  return [{ path: folderPath, pinned }];
}

function normalizePinnedSessionSetting(item: unknown): PinnedSessionSetting[] {
  if (!item || typeof item !== "object") return [];

  const record = item as Record<string, unknown>;
  const filePath = typeof record.filePath === "string"
    ? record.filePath.trim()
    : "";
  const pinnedAt = typeof record.pinnedAt === "number"
    ? record.pinnedAt
    : 0;
  if (!filePath || !Number.isFinite(pinnedAt) || pinnedAt <= 0) return [];

  return [{ filePath, pinnedAt }];
}

function normalizeHashAutocompleteOption(item: unknown): HashAutocompleteOption[] {
  if (!item || typeof item !== "object") return [];

  const record = item as Record<string, unknown>;
  const rawCommand = typeof record.command === "string" ? record.command.trim() : "";
  const value = typeof record.value === "string" ? record.value : "";
  if (!rawCommand || !value) return [];

  const command = rawCommand.startsWith("#") ? rawCommand : `#${rawCommand}`;
  if (/\s/.test(command)) return [];

  return [{ command, value }];
}

function normalizeProviderOption(item: unknown): ProviderOption[] {
  if (!item || typeof item !== "object") return [];

  const record = item as Record<string, unknown>;
  const nickname = typeof record.nickname === "string" ? record.nickname.trim() : "";
  const cliArgs = typeof record.cliArgs === "string" ? record.cliArgs.trim() : "";
  if (!nickname || !cliArgs) return [];

  const environmentVariables = typeof record.environmentVariables === "string"
    ? record.environmentVariables.trim()
    : "";
  return [{ nickname, cliArgs, ...(environmentVariables ? { environmentVariables } : {}) }];
}

function normalizeEnvironmentVariablesOption(item: unknown): EnvironmentVariablesOption[] {
  if (!item || typeof item !== "object") return [];

  const record = item as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const value = typeof record.value === "string" ? record.value.trim() : "";
  return title && value ? [{ title, value }] : [];
}
