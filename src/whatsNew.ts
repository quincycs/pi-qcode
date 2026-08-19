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
    title: "V0.1.5 - Steer instead of followup",
    description:
      "Sending a message while the model is busy will inject the message into the soonest possible point without aborting.  Previously this would send a followup message after the whole turn was complete.",
  },
  {
    title: "V0.1.3 - Reply",
    description:
      "Highlight text and right click to reply. This will add the text to the input box to save you a copy/paste.",
  },
  {
    title: "V0.1.2 - Mermaid support",
    description:
      "Mermaid diagrams are now supported in pi and qcode rendering.",
  },
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
