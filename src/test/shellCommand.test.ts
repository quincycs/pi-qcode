import * as assert from "node:assert/strict";
import { test } from "node:test";
import { serializeQcodeAttachmentPrompt } from "../chatAttachments";
import {
  buildTerminalCommand,
  prepareTerminalArgument,
  quoteTerminalArgument,
  resolveTerminalShell,
} from "../shellCommand";

test("resolves common shells and replaces Command Prompt with PowerShell", () => {
  assert.deepEqual(resolveTerminalShell("/bin/zsh"), { kind: "posix" });
  assert.deepEqual(resolveTerminalShell("C:\\Program Files\\PowerShell\\7\\pwsh.exe"), {
    kind: "powershell",
  });
  assert.deepEqual(resolveTerminalShell("C:\\Windows\\System32\\cmd.exe", "win32"), {
    kind: "powershell",
    shellPath: "powershell.exe",
  });
  assert.deepEqual(resolveTerminalShell(undefined, "win32"), {
    kind: "powershell",
    shellPath: "powershell.exe",
  });
});

test("quotes spaces, apostrophes, multiline prompts, and leading at signs", () => {
  assert.equal(quoteTerminalArgument("a'b", "posix"), `'a'\\''b'`);
  assert.equal(quoteTerminalArgument("a'b", "powershell"), `'a''b'`);
  assert.equal(
    quoteTerminalArgument("line 1\n& echo injected\nline '2'", "powershell"),
    `'line 1\n& echo injected\nline ''2'''`,
  );
  assert.equal(prepareTerminalArgument("@file\nnext"), " @file\nnext");
  assert.equal(quoteTerminalArgument("@file\nnext", "posix"), `' @file\nnext'`);
  assert.equal(
    buildTerminalCommand("pi", ["-e", "/tmp/a bridge.ts", "hello"], "posix"),
    "pi '-e' '/tmp/a bridge.ts' 'hello'",
  );

  const prompt = serializeQcodeAttachmentPrompt("see file", [{
    id: "id",
    name: "screen shot.png",
    path: "C:\\Users\\Name\\Temp\\pi-qcode\\id\\screen shot.png",
  }]);
  const command = buildTerminalCommand("pi", [prompt], "powershell");
  assert.match(command, /C:\\Users\\Name\\Temp\\pi-qcode\\id\\screen shot\.png/);
  assert.match(command, /<qcode-attachments>/);
});
