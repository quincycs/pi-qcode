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
    title: "V0.1.9 - Slack Share",
    description:
      "Slack Share gives broader team visibility of Qcode session messages. It's a one-way integration from Qcode to Slack, not remote control.",
  },
  {
    title: "V0.1.8 - Env file support",
    description:
      "Support for .env file to be loaded into the pi terminal. Specify an env file on the provider option. Useful for skills that expect certain environment variables.",
  },
  {
    title: "V0.1.6 - Support Extension UI prompt events",
    description:
      "Please update pi to 0.84.4+ , which now emits events that qcode knows there's a terminal blocking action that needs to be addressed. Previously recommended workarounds of emitting pi-lifecycle events are no longer needed.",
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
