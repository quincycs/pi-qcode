import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface HashAutocompleteOption {
  command: string;
  value: string;
}

export interface ProviderOption {
  nickname: string;
  cliArgs: string;
}

export interface QcodeSettings {
  hashAutocompleteOptions: HashAutocompleteOption[];
  providerOptions: ProviderOption[];
  lastUsedProviderNickname: string;
  assistantSoundEnabled: boolean;
  assistantSoundPath: string;
  dismissedWhatsNewVersions: string[];
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
      hashAutocompleteOptions: [],
      providerOptions: [],
      lastUsedProviderNickname: "",
      assistantSoundEnabled: false,
      assistantSoundPath: "",
      dismissedWhatsNewVersions: [],
    };
  }
}

export async function writeQcodeSettings(
  settings: unknown,
  filePath = settingsFilePath,
): Promise<QcodeSettings> {
  const record = settings && typeof settings === "object"
    ? settings as Record<string, unknown>
    : {};
  const normalized = normalizeSettings(settings);

  // The settings UI does not edit internal state, so preserve it when omitted.
  if (!Object.prototype.hasOwnProperty.call(record, "dismissedWhatsNewVersions")) {
    normalized.dismissedWhatsNewVersions = readQcodeSettings(
      filePath,
    ).dismissedWhatsNewVersions;
  }

  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(
    filePath,
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );
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

  return {
    hashAutocompleteOptions,
    providerOptions,
    lastUsedProviderNickname,
    assistantSoundEnabled,
    assistantSoundPath,
    dismissedWhatsNewVersions,
  };
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

  return [{ nickname, cliArgs }];
}
