import { StringDecoder } from "node:string_decoder";

export const PI_BRIDGE_PROTOCOL_VERSION = 1 as const;
export const PI_BRIDGE_MAX_RECORD_BYTES = 4 * 1024 * 1024;
export const PI_BRIDGE_MAX_MESSAGE_BYTES = 192 * 1024;

export type BridgeConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "bridge_incompatible"
  | "terminal_exited"
  | "bridge_unavailable";

export interface BridgeModel {
  provider?: string;
  id?: string;
  contextWindow?: number;
}

export interface BridgeContextUsage {
  tokens?: number;
  contextWindow?: number;
  percent?: number;
  sessionCost?: number;
}

export interface BridgeSessionState {
  sessionId?: string;
  sessionFile?: string;
  sessionName?: string;
  leafId?: string | null;
  idle: boolean;
  model?: BridgeModel;
  thinkingLevel?: string;
  contextUsage?: BridgeContextUsage;
}

export interface BridgeSnapshotEntry {
  type: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string | number;
  [key: string]: unknown;
}

interface BridgeEventBase {
  protocolVersion: typeof PI_BRIDGE_PROTOCOL_VERSION;
  type: string;
  bridgeId: string;
  /** Monotonic within one bridge instance. */
  sequence: number;
}

export interface BridgeHelloEvent extends BridgeEventBase, BridgeSessionState {
  type: "hello";
  instanceId: string;
  pid: number;
  cwd: string;
  userInputWaits?: BridgeUserInputWait[];
}

export interface BridgeSessionStateEvent extends BridgeEventBase {
  type: "session_state";
  state: BridgeSessionState;
}

export interface BridgeSessionSnapshotEvent extends BridgeEventBase {
  type: "session_snapshot";
  entries: BridgeSnapshotEntry[];
  leafId?: string | null;
  sequenceCovered: number;
}

export interface BridgeUserInputEvent extends BridgeEventBase {
  type: "user_input";
  text: string;
  source: string;
  clientMessageId?: string;
}

export interface BridgeUserInputWait {
  waitId: string;
  message?: string;
}

export interface BridgeUserInputWaitEvent extends BridgeEventBase, BridgeUserInputWait {
  type: "user_input_wait_start" | "user_input_wait_end";
}

export interface BridgeLifecycleEvent extends BridgeEventBase {
  type:
    | "agent_start"
    | "agent_settled"
    | "session_compact"
    | "session_shutdown";
  reason?: string;
}

export interface BridgeMessageEvent extends BridgeEventBase {
  type: "message_start" | "message_end";
  message: unknown;
}

export interface BridgeToolEvent extends BridgeEventBase {
  type: "tool_execution_start" | "tool_execution_end";
  toolCallId: string;
  toolName: string;
  /** Canonical skill name when a read call loads a SKILL.md file. */
  skillName?: string;
  isError?: boolean;
}

export interface BridgeErrorEvent extends BridgeEventBase {
  type: "bridge_error";
  code: string;
  message: string;
}

export interface BridgeCommandAck extends BridgeEventBase {
  type: "command_ack";
  requestId: string;
  ok: boolean;
  error?: { code: string; message: string };
}

export type BridgeToQcodeMessage =
  | BridgeHelloEvent
  | BridgeSessionStateEvent
  | BridgeSessionSnapshotEvent
  | BridgeUserInputEvent
  | BridgeUserInputWaitEvent
  | BridgeLifecycleEvent
  | BridgeMessageEvent
  | BridgeToolEvent
  | BridgeErrorEvent
  | BridgeCommandAck;

interface BridgeCommandBase {
  protocolVersion: typeof PI_BRIDGE_PROTOCOL_VERSION;
  type: string;
  requestId: string;
}

export interface AuthenticateCommand extends BridgeCommandBase {
  type: "authenticate";
  token: string;
}

export interface SendUserMessageCommand extends BridgeCommandBase {
  type: "send_user_message";
  clientMessageId: string;
  text: string;
  delivery: "steer";
}

export interface RequestSnapshotCommand extends BridgeCommandBase {
  type: "request_snapshot";
}

export interface PingCommand extends BridgeCommandBase {
  type: "ping";
}

export type QcodeToBridgeMessage =
  | AuthenticateCommand
  | SendUserMessageCommand
  | RequestSnapshotCommand
  | PingCommand;

export interface BridgeRegistration {
  protocolVersion: number;
  bridgeId: string;
  instanceId: string;
  token: string;
  port: number;
  pid: number;
  cwd: string;
  sessionId?: string;
  sessionFile?: string;
  sessionName?: string;
  updatedAt: string;
}

export type FrameResult =
  | { kind: "record"; value: unknown }
  | { kind: "error"; code: "malformed_json" | "record_too_large"; message: string };

/** Stateful LF-delimited JSON parser. StringDecoder preserves split UTF-8 code points. */
export class JsonLineDecoder {
  private readonly decoder = new StringDecoder("utf8");
  private text = "";
  private byteCount = 0;
  private discardingOversizedRecord = false;

  constructor(private readonly maxRecordBytes = PI_BRIDGE_MAX_RECORD_BYTES) {}

  push(chunk: Buffer): FrameResult[] {
    const results: FrameResult[] = [];
    let start = 0;
    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] !== 0x0a) continue;
      this.appendChunk(chunk.subarray(start, index));
      if (this.discardingOversizedRecord || this.byteCount > this.maxRecordBytes) {
        results.push({
          kind: "error",
          code: "record_too_large",
          message: `Bridge record exceeds ${this.maxRecordBytes} bytes.`,
        });
      } else {
        let line = this.text;
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line) {
          try {
            results.push({ kind: "record", value: JSON.parse(line) });
          } catch {
            results.push({
              kind: "error",
              code: "malformed_json",
              message: "Bridge sent malformed JSON.",
            });
          }
        }
      }
      this.resetRecord();
      start = index + 1;
    }
    this.appendChunk(chunk.subarray(start));
    if (!this.discardingOversizedRecord && this.byteCount > this.maxRecordBytes) {
      this.discardingOversizedRecord = true;
      this.text = "";
    }
    return results;
  }

  end(): FrameResult[] {
    const trailing = this.decoder.end();
    if (trailing) this.text += trailing;
    if (!this.text && !this.byteCount && !this.discardingOversizedRecord) return [];
    // Protocol records must be LF terminated; silently discard a partial final record.
    this.resetRecord();
    return [];
  }

  private appendChunk(chunk: Buffer): void {
    if (!chunk.length) return;
    this.byteCount += chunk.length;
    if (!this.discardingOversizedRecord) this.text += this.decoder.write(chunk);
  }

  private resetRecord(): void {
    this.decoder.end();
    this.text = "";
    this.byteCount = 0;
    this.discardingOversizedRecord = false;
  }
}

export function encodeBridgeRecord(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

export function validateBridgeMessage(value: unknown):
  | { ok: true; message: BridgeToQcodeMessage }
  | { ok: false; code: string; message: string } {
  const record = readRecord(value);
  if (!record || typeof record.type !== "string") {
    return invalid("invalid_message", "Bridge message must be a JSON object with a type.");
  }
  if (record.protocolVersion !== PI_BRIDGE_PROTOCOL_VERSION) {
    return invalid(
      "incompatible_protocol",
      `Unsupported qcode bridge protocol ${String(record.protocolVersion)}. Update Pi and pi-qcode.`,
    );
  }
  if (typeof record.bridgeId !== "string" || !record.bridgeId) {
    return invalid("invalid_message", "Bridge message is missing its bridge ID.");
  }
  if (!Number.isSafeInteger(record.sequence) || Number(record.sequence) < 1) {
    return invalid("invalid_message", "Bridge message is missing its event sequence.");
  }

  const simpleTypes = new Set([
    "hello", "session_state", "session_snapshot", "user_input", "user_input_wait_start",
    "user_input_wait_end", "agent_start", "agent_settled", "session_compact", "message_start",
    "message_end", "tool_execution_start",
    "tool_execution_end", "session_shutdown", "bridge_error", "command_ack",
  ]);
  if (!simpleTypes.has(record.type)) {
    return invalid("unknown_message", `Unknown bridge message type: ${record.type}`);
  }
  if (record.type === "hello" && (
    typeof record.instanceId !== "string" || !Number.isInteger(record.pid) ||
    typeof record.cwd !== "string" || typeof record.idle !== "boolean" ||
    (record.userInputWaits !== undefined && (
      !Array.isArray(record.userInputWaits) || !record.userInputWaits.every(isUserInputWait)
    ))
  )) return invalid("invalid_message", "Bridge hello event is incomplete.");
  if (record.type === "session_state" && (
    !readRecord(record.state) || typeof readRecord(record.state)?.idle !== "boolean"
  )) {
    return invalid("invalid_message", "Bridge session state is invalid.");
  }
  if (record.type === "session_snapshot" && (
    !Array.isArray(record.entries) || !Number.isSafeInteger(record.sequenceCovered)
  )) {
    return invalid("invalid_message", "Bridge snapshot entries or sequence are invalid.");
  }
  if (record.type === "user_input" && (
    typeof record.text !== "string" || typeof record.source !== "string" ||
    (record.clientMessageId !== undefined && typeof record.clientMessageId !== "string")
  )) return invalid("invalid_message", "Bridge user input event is invalid.");
  if ((record.type === "user_input_wait_start" || record.type === "user_input_wait_end") &&
    !isUserInputWait(record)
  ) return invalid("invalid_message", "Bridge user input wait event is invalid.");
  if ((record.type === "message_start" || record.type === "message_end") && !readRecord(record.message)) {
    return invalid("invalid_message", "Bridge message event has no message.");
  }
  if ((record.type === "tool_execution_start" || record.type === "tool_execution_end") && (
    typeof record.toolCallId !== "string" || typeof record.toolName !== "string" ||
    (record.skillName !== undefined && typeof record.skillName !== "string")
  )) return invalid("invalid_message", "Bridge tool event is incomplete.");
  if (record.type === "bridge_error" && (typeof record.code !== "string" || typeof record.message !== "string")) {
    return invalid("invalid_message", "Bridge error event is invalid.");
  }
  if (record.type === "command_ack" && (typeof record.requestId !== "string" || typeof record.ok !== "boolean")) {
    return invalid("invalid_message", "Bridge acknowledgement is invalid.");
  }
  return { ok: true, message: record as unknown as BridgeToQcodeMessage };
}

export function validateBridgeCommand(value: unknown):
  | { ok: true; command: QcodeToBridgeMessage }
  | { ok: false; code: string; message: string; requestId?: string } {
  const record = readRecord(value);
  const requestId = typeof record?.requestId === "string" ? record.requestId : undefined;
  if (!record || typeof record.type !== "string" || !requestId) {
    return { ...invalid("invalid_command", "Bridge command must include type and requestId."), requestId };
  }
  if (record.protocolVersion !== PI_BRIDGE_PROTOCOL_VERSION) {
    return {
      ...invalid("incompatible_protocol", `Unsupported qcode bridge protocol ${String(record.protocolVersion)}. Update pi-qcode.`),
      requestId,
    };
  }
  if (record.type === "authenticate") {
    return typeof record.token === "string" && record.token
      ? { ok: true, command: record as unknown as AuthenticateCommand }
      : { ...invalid("invalid_command", "Authentication token is required."), requestId };
  }
  if (record.type === "send_user_message") {
    if (typeof record.clientMessageId !== "string" || !record.clientMessageId) {
      return { ...invalid("invalid_message", "Client message ID is required."), requestId };
    }
    if (typeof record.text !== "string" || !record.text.trim()) {
      return { ...invalid("invalid_message", "Message text cannot be empty."), requestId };
    }
    if (Buffer.byteLength(record.text, "utf8") > PI_BRIDGE_MAX_MESSAGE_BYTES) {
      return { ...invalid("message_too_large", `Message exceeds ${PI_BRIDGE_MAX_MESSAGE_BYTES} bytes.`), requestId };
    }
    if (record.delivery !== "steer") {
      return { ...invalid("invalid_delivery", "Only steer delivery is supported."), requestId };
    }
    return { ok: true, command: record as unknown as SendUserMessageCommand };
  }
  if (record.type === "request_snapshot" || record.type === "ping") {
    return { ok: true, command: record as unknown as RequestSnapshotCommand | PingCommand };
  }
  return { ...invalid("unknown_command", `Unknown bridge command type: ${record.type}`), requestId };
}

export function readBridgeRegistration(value: unknown): BridgeRegistration | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  if (
    typeof record.bridgeId !== "string" || !record.bridgeId ||
    !Number.isInteger(record.protocolVersion) || Number(record.protocolVersion) < 1 ||
    typeof record.instanceId !== "string" || !record.instanceId ||
    typeof record.token !== "string" || !record.token ||
    !Number.isInteger(record.port) || Number(record.port) < 1 || Number(record.port) > 65535 ||
    !Number.isInteger(record.pid) || Number(record.pid) < 1 ||
    typeof record.cwd !== "string"
  ) return undefined;
  return record as unknown as BridgeRegistration;
}

function isUserInputWait(value: unknown): boolean {
  const record = readRecord(value);
  return Boolean(
    record && typeof record.waitId === "string" && record.waitId &&
    (record.message === undefined || typeof record.message === "string"),
  );
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function invalid(code: string, message: string): { ok: false; code: string; message: string } {
  return { ok: false, code, message };
}
