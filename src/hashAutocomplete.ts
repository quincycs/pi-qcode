import { readQcodeSettings, type HashAutocompleteOption } from "./qcodeSettings";

export interface HashAutocompleteSuggestion {
  command: string;
  value: string;
  label: string;
  description: string;
}

const defaultLimit = 20;

export function searchHashAutocompleteSuggestions(
  query: string,
  limit = defaultLimit,
): HashAutocompleteSuggestion[] {
  const options = readQcodeSettings().hashAutocompleteOptions;
  const searchText = `#${query.trim().toLowerCase().replace(/^#/, "")}`;
  const hasQuery = searchText.length > 1;

  return options
    .map((option, index) => ({
      option,
      index,
      score: hasQuery ? scoreOption(option.command.toLowerCase(), searchText) : 0,
    }))
    .filter((result) => result.score !== Number.POSITIVE_INFINITY)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map(({ option }) => toSuggestion(option));
}

function toSuggestion(option: HashAutocompleteOption): HashAutocompleteSuggestion {
  return {
    command: option.command,
    value: option.value,
    label: option.command,
    description: option.value,
  };
}

function scoreOption(command: string, query: string): number {
  if (command === query) return 0;
  if (command.startsWith(query)) return 1;
  if (command.includes(query)) return 2 + command.indexOf(query) / 100;
  return Number.POSITIVE_INFINITY;
}
