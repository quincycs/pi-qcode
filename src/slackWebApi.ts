import * as fs from "node:fs";
import { LogLevel, WebClient, type Logger, type WebClientOptions } from "@slack/web-api";
import type { ChatAttachment } from "./chatAttachments";

// All failures go through SlackShare's redacted native error UI, never SDK console logging.
const silentLogger: Logger = {
  debug() {}, info() {}, warn() {}, error() {}, setLevel() {}, setName() {},
  getLevel: () => LogLevel.ERROR,
};

export class SlackWebApi {
  constructor(
    private readonly createClient: (token: string, options: WebClientOptions) => WebClient =
      (token, options) => new WebClient(token, options),
  ) {}

  private client(token: string): WebClient {
    if (!token) throw new Error("Missing Slack token.");
    return this.createClient(token, {
      // The SDK normally retries failures and waits on rate limits. Sharing must do neither.
      retryConfig: { retries: 0 },
      rejectRateLimitedCalls: true,
      timeout: 30_000,
      logger: silentLogger,
    });
  }

  async post(token: string, channelId: string, text: string, threadTs?: string): Promise<string> {
    if (!channelId) throw new Error("Missing SLACK_CHANNEL_ID.");
    const response = await this.client(token).chat.postMessage({
      // Standard Markdown, rather than Slack's legacy mrkdwn syntax.
      channel: channelId, markdown_text: text,
      ...(threadTs ? { thread_ts: threadTs } : {}),
      unfurl_links: false, unfurl_media: false,
    });
    if (typeof response.ts !== "string" || !/^\d+\.\d+$/.test(response.ts)) {
      throw new Error("chat.postMessage: Slack did not return a message timestamp.");
    }
    return response.ts;
  }

  async upload(token: string, channelId: string, threadTs: string, attachment: ChatAttachment): Promise<void> {
    const stat = await fs.promises.stat(attachment.path);
    if (!stat.isFile()) throw new Error(`Attachment is not a file: ${attachment.name}`);
    // uploadV2 handles URL negotiation, binary transfer and completion with the same
    // identity and no-retry policy, including the binary upload request.
    await this.client(token).files.uploadV2({
      file: attachment.path,
      filename: attachment.name,
      title: attachment.name,
      channel_id: channelId,
      thread_ts: threadTs,
    });
  }
}
