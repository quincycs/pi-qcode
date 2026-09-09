import * as path from "node:path";
import type { PiTerminalSessionView } from "./piTerminalSessions";
import { getSessionFolderForCwd, type RecentSession } from "./sessionFiles";
import { sessionPinKey } from "./sessionPins";

export interface HomeSession extends RecentSession {
  bridgeId?: string;
  busy?: boolean;
}

/** Keep bridge-backed rows available even before Pi creates its JSONL file. */
export class HomeSessions {
  private readonly sessions = new Map<string, HomeSession>();

  update(session: PiTerminalSessionView, cwd: string, now = new Date()): void {
    const previous = this.sessions.get(session.bridgeId);
    const users = session.messages.filter((message) => message.role === "user");
    const preview = (message: typeof users[number] | undefined) => {
      const text = message?.text.trim() || (message?.attachments?.length
        ? `Attached: ${message.attachments.map((attachment) => attachment.name).join(", ")}`
        : "");
      return text.slice(0, 160).replace(/\s+/g, " ").trim();
    };
    const filePath = session.sessionFile || previous?.filePath || "";
    this.sessions.set(session.bridgeId, {
      id: session.sessionId || previous?.id || session.bridgeId,
      bridgeId: session.bridgeId,
      cwd: previous?.cwd || cwd,
      filePath,
      fileName: filePath ? path.basename(filePath) : "New Session",
      title: session.sessionName || preview(users[0]) || previous?.title || "New Session",
      preview: preview(users.at(-1)) || previous?.preview || "(no messages yet)",
      model: session.contextUsage?.modelId || previous?.model || "unknown",
      messageCount: session.messages.filter((message) =>
        message.role === "assistant" && message.kind !== "thinking").length,
      totalTokens: 0,
      createdAt: previous?.createdAt || now,
      lastActiveAt: now,
      busy: session.busy === true,
    });
  }

  merge(persisted: RecentSession[], cwd?: string): HomeSession[] {
    const result: HomeSession[] = persisted.map((session) => ({ ...session }));
    for (const live of this.sessions.values()) {
      if (cwd && (live.filePath
        ? sessionPinKey(path.dirname(live.filePath)) !== sessionPinKey(getSessionFolderForCwd(cwd))
        : sessionPinKey(live.cwd) !== sessionPinKey(cwd))) continue;
      const index = result.findIndex((session) =>
        Boolean(live.filePath && session.filePath &&
          sessionPinKey(live.filePath) === sessionPinKey(session.filePath)) ||
        session.id === live.id);
      if (index < 0) {
        result.push({ ...live });
      } else {
        const saved = result[index];
        result[index] = {
          ...live,
          ...saved,
          bridgeId: live.bridgeId,
          busy: live.busy || saved.busy,
          ...(live.busy ? {
            lastActiveAt: live.lastActiveAt,
            preview: live.preview,
            messageCount: Math.max(saved.messageCount, live.messageCount),
          } : {}),
        };
      }
    }
    return result;
  }
}
