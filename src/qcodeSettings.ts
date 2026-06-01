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
}

const settingsDirectory = path.join(os.homedir(), ".pi", "qcode");
const settingsFilePath = path.join(settingsDirectory, "settings.json");

export function getSettingsFilePath(): string {
  return settingsFilePath;
}

export function readQcodeSettings(): QcodeSettings {
  try {
    const raw = fs.readFileSync(settingsFilePath, "utf8");
    return normalizeSettings(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("Unable to read pi-qcode settings:", error);
    }
    return {
      hashAutocompleteOptions: [],
      providerOptions: [],
      lastUsedProviderNickname: "",
    };
  }
}

export async function writeQcodeSettings(settings: unknown): Promise<QcodeSettings> {
  const normalized = normalizeSettings(settings);
  await fs.promises.mkdir(settingsDirectory, { recursive: true });
  await fs.promises.writeFile(
    settingsFilePath,
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );
  return normalized;
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

  return { hashAutocompleteOptions, providerOptions, lastUsedProviderNickname };
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
