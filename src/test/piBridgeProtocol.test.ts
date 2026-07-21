import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  JsonLineDecoder,
  PI_BRIDGE_PROTOCOL_VERSION,
  validateBridgeCommand,
  validateBridgeMessage,
} from "../piBridgeProtocol";

test("decodes split UTF-8 and multiple LF-delimited records", () => {
  const decoder = new JsonLineDecoder();
  const bytes = Buffer.from('{"text":"héllo 👋"}\n{"value":2}\n', "utf8");
  const split = bytes.indexOf(Buffer.from("👋")) + 2;
  assert.deepEqual(decoder.push(bytes.subarray(0, split)), []);
  assert.deepEqual(decoder.push(bytes.subarray(split)), [
    { kind: "record", value: { text: "héllo 👋" } },
    { kind: "record", value: { value: 2 } },
  ]);
});

test("accepts CRLF and reports malformed and oversized records", () => {
  const decoder = new JsonLineDecoder(8);
  assert.deepEqual(decoder.push(Buffer.from('{}\r\nnot-json\n123456789\n')), [
    { kind: "record", value: {} },
    { kind: "error", code: "malformed_json", message: "Bridge sent malformed JSON." },
    { kind: "error", code: "record_too_large", message: "Bridge record exceeds 8 bytes." },
  ]);
});

test("validates authentication, versions, and message limits", () => {
  const auth = validateBridgeCommand({
    protocolVersion: PI_BRIDGE_PROTOCOL_VERSION,
    type: "authenticate",
    requestId: "1",
    token: "secret",
  });
  assert.equal(auth.ok, true);
  const incompatible = validateBridgeCommand({
    protocolVersion: 99,
    type: "ping",
    requestId: "2",
  });
  assert.equal(incompatible.ok, false);
  if (!incompatible.ok) assert.equal(incompatible.code, "incompatible_protocol");

  const missingClientId = validateBridgeCommand({
    protocolVersion: PI_BRIDGE_PROTOCOL_VERSION,
    type: "send_user_message",
    requestId: "3",
    text: "hello",
    delivery: "followUp",
  });
  assert.equal(missingClientId.ok, false);
  const send = validateBridgeCommand({
    protocolVersion: PI_BRIDGE_PROTOCOL_VERSION,
    type: "send_user_message",
    requestId: "4",
    clientMessageId: "client-1",
    text: "hello",
    delivery: "followUp",
  });
  assert.equal(send.ok, true);

  const missingSequence = validateBridgeMessage({
    protocolVersion: PI_BRIDGE_PROTOCOL_VERSION,
    type: "agent_start",
    bridgeId: "bridge-1",
  });
  assert.equal(missingSequence.ok, false);
  const userInput = validateBridgeMessage({
    protocolVersion: PI_BRIDGE_PROTOCOL_VERSION,
    type: "user_input",
    bridgeId: "bridge-1",
    sequence: 1,
    text: "hello",
    source: "extension",
    clientMessageId: "client-1",
  });
  assert.equal(userInput.ok, true);

  const waitStart = validateBridgeMessage({
    protocolVersion: PI_BRIDGE_PROTOCOL_VERSION,
    type: "user_input_wait_start",
    bridgeId: "bridge-1",
    sequence: 2,
    waitId: "permission:tool-1",
    message: "Approval is required.",
  });
  assert.equal(waitStart.ok, true);

  const helloWithWait = validateBridgeMessage({
    protocolVersion: PI_BRIDGE_PROTOCOL_VERSION,
    type: "hello",
    bridgeId: "bridge-1",
    sequence: 3,
    instanceId: "instance-1",
    pid: 123,
    cwd: "/workspace",
    idle: false,
    userInputWaits: [{ waitId: "permission:tool-1" }],
  });
  assert.equal(helloWithWait.ok, true);

  const skillRead = validateBridgeMessage({
    protocolVersion: PI_BRIDGE_PROTOCOL_VERSION,
    type: "tool_execution_start",
    bridgeId: "bridge-1",
    sequence: 4,
    toolCallId: "tool-1",
    toolName: "read",
    skillName: "code-review",
  });
  assert.equal(skillRead.ok, true);

  const invalidWait = validateBridgeMessage({
    protocolVersion: PI_BRIDGE_PROTOCOL_VERSION,
    type: "user_input_wait_end",
    bridgeId: "bridge-1",
    sequence: 5,
    waitId: "",
  });
  assert.equal(invalidWait.ok, false);
});
