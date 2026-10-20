import * as path from "node:path";
import { parseQcodeAttachmentBlock } from "./chatAttachments";
import { readQcodeSettings, saveSlackShareThread, type SlackShareSettings, type SlackShareThread } from "./qcodeSettings";
import { SlackWebApi } from "./slackWebApi";

interface ShareSession {
  channelId: string;
  threadTs?: string;
  queue: Promise<void>;
}

interface SlackShareOptions {
  readSettings?: typeof readQcodeSettings;
  saveThread?: typeof saveSlackShareThread;
  api?: Pick<SlackWebApi, "post" | "upload">;
  showError: (message: string) => void;
}

/** Best-effort, ordered, non-blocking delivery. Snapshots/history must never enter this queue. */
export class SlackShare {
  private readonly sessions = new Map<string, ShareSession>();
  private readonly readSettings: typeof readQcodeSettings;
  private readonly saveThread: typeof saveSlackShareThread;
  private readonly api: Pick<SlackWebApi, "post" | "upload">;

  constructor(private readonly options: SlackShareOptions) {
    this.readSettings = options.readSettings || readQcodeSettings;
    this.saveThread = options.saveThread || saveSlackShareThread;
    this.api = options.api || new SlackWebApi();
  }

  startSession(sessionFile: string, rawText: string, settings: SlackShareSettings): void {
    if (!settings.enabled) return;
    const key = path.resolve(sessionFile);
    if (this.sessions.has(key)) return;
    const session: ShareSession = { channelId: settings.channelId, queue: Promise.resolve() };
    this.sessions.set(key, session);
    this.enqueue(session, settings, async () => {
      const { text, attachments } = parseQcodeAttachmentBlock(rawText);
      const threadTs = await this.api.post(this.token(settings, "user"), settings.channelId, `qcode: ${text || "Attachments"}`);
      session.threadTs = threadTs;
      // Save before later sends, but a local persistence failure must not disable an
      // established Slack thread. Keep using it in memory, without retrying the save.
      try {
        await this.saveThread({ sessionFile: key, channelId: settings.channelId, threadTs });
      } catch (error) {
        this.report(error, settings, "thread persistence (resume sharing unavailable)");
      }
      await this.shareAttachments(session, settings, attachments);
    });
  }

  shareUser(sessionFile: string, rawText: string, settings?: SlackShareSettings): void {
    this.share(sessionFile, rawText, "user", settings);
  }

  shareAssistant(sessionFile: string, text: string): void {
    if (text.trim()) this.share(sessionFile, text, "assistant");
  }

  private share(sessionFile: string, rawText: string, role: "user" | "assistant", submittedSettings?: SlackShareSettings): void {
    const settings = this.readSettings();
    const shareSettings = submittedSettings || settings.slackShare;
    if (!shareSettings?.enabled) return;
    const key = path.resolve(sessionFile);
    let session = this.sessions.get(key);
    if (!session) {
      const thread = settings.slackShareThreads.find((item: SlackShareThread) => item.sessionFile === key);
      if (!thread) return; // Resuming a never-shared session: no backfill or new thread.
      session = { ...thread, queue: Promise.resolve() };
      this.sessions.set(key, session);
    }
    const target = session;
    this.enqueue(target, shareSettings, async () => {
      if (!target.threadTs) return;
      const { text, attachments } = role === "user"
        ? parseQcodeAttachmentBlock(rawText) : { text: rawText, attachments: [] };
      const message = `${role === "user" ? "qcode: " : ""}${text || "Attachments"}`;
      await this.api.post(this.token(shareSettings, role), target.channelId, message, target.threadTs);
      await this.shareAttachments(target, shareSettings, attachments);
    });
  }

  private enqueue(session: ShareSession, settings: SlackShareSettings, send: () => Promise<void>): void {
    if (!settings.enabled || settings.channelId !== session.channelId) return;
    session.queue = session.queue.then(async () => {
      // Check again at dispatch: queued work must not leak after disabling/changing channels.
      if (!this.isCurrent(settings)) return;
      await send();
    }).catch((error: unknown) => this.report(error, settings));
  }

  private async shareAttachments(
    session: ShareSession,
    settings: SlackShareSettings,
    attachments: ReturnType<typeof parseQcodeAttachmentBlock>["attachments"],
  ): Promise<void> {
    for (const attachment of attachments) {
      if (!this.isCurrent(settings)) return;
      try {
        await this.api.upload(this.token(settings, "user"), session.channelId, session.threadTs!, attachment);
      } catch (error) {
        this.report(error, settings, `attachment ${attachment.name}`);
      }
    }
  }

  private isCurrent(settings: SlackShareSettings): boolean {
    const current = this.readSettings().slackShare;
    return Boolean(current?.enabled && current.channelId === settings.channelId);
  }

  private token(settings: SlackShareSettings, role: "user" | "assistant"): string {
    const token = role === "user" ? settings.userToken : settings.botToken;
    if (!token) throw new Error(`Missing ${role === "user" ? "SLACK_USER_TOKEN" : "SLACK_BOT_TOKEN"}.`);
    return token;
  }

  private report(error: unknown, settings: SlackShareSettings, operation = "message"): void {
    let reason = error instanceof Error ? error.message : String(error);
    for (const token of [settings.userToken, settings.botToken]) {
      if (token) reason = reason.split(token).join("[redacted]");
    }
    // Diagnostics can contain credentials from other sources; never display Slack tokens.
    reason = reason.replace(/xox[a-z]-[A-Za-z0-9-]+/g, "[redacted]");
    this.options.showError(`Slack Share ${operation} failed: ${reason}`);
  }

  /** Await pending deliveries in tests without making chat wait for Slack. */
  async whenIdle(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => session.queue));
  }
}
