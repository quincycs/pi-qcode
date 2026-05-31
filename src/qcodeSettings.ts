import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface HashAutocompleteOption {
  command: string;
  value: string;
}

export interface QcodeSettings {
  hashAutocompleteOptions: HashAutocompleteOption[];
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
      console.error("Unable to read QCode settings:", error);
    }
    return { hashAutocompleteOptions: [] };
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

  return { hashAutocompleteOptions };
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
