#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const vsixPath = path.resolve(process.argv[2] || "pi-qcode.vsix");
const requiredEntries = [
  "extension/pi-extensions/qcode-bridge.ts",
  "extension/media/vendor/mermaid.min.js",
];
let archive;
try {
  archive = fs.readFileSync(vsixPath);
} catch (error) {
  console.error(`Unable to read VSIX: ${vsixPath}`);
  process.exitCode = 1;
  return;
}
const missingEntries = requiredEntries.filter(
  (entry) => !archive.includes(Buffer.from(entry, "utf8")),
);
if (missingEntries.length) {
  console.error(`VSIX is missing required files: ${missingEntries.join(", ")}`);
  process.exitCode = 1;
  return;
}
console.log(`Verified bundled qcode bridge and Mermaid renderer in ${path.basename(vsixPath)}`);
