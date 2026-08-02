export interface WhatsNewItem {
  title: string;
  description: string;
}

export interface WhatsNewRelease {
  version: string;
  items: WhatsNewItem[];
}

// Update these items for each release. The version comes from package.json at runtime.
const currentReleaseItems: WhatsNewItem[] = [
  {
    title: "V0.1.1 - Fix notification sound reliability",
    description: "The notification sound now plays reliably.",
  },
  {
    title: "V0.1.0 - No more required extensions. No wasted tokens.",
    description:
      "You can remove pi-msg and pi-lifecycle extensions from pi as they are unnecessary now. Instead this vscode extension is packaged with the required pi bridge extension. This new bridge extension uses 0 tokens. Previous extensions used a few unnecessary tokens.",
  },
];

export function getWhatsNewRelease(
  version: string,
): WhatsNewRelease | undefined {
  if (currentReleaseItems.length === 0) {
    return undefined;
  }
  return { version, items: currentReleaseItems };
}
