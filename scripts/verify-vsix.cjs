#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const vsixPath = path.resolve(process.argv[2] || "pi-qcode.vsix");
const requiredEntry = Buffer.from("extension/pi-extensions/qcode-bridge.ts", "utf8");
let archive;
try {
  archive = fs.readFileSync(vsixPath);
} catch (error) {
  console.error(`Unable to read VSIX: ${vsixPath}`);
  process.exitCode = 1;
  return;
}
if (!archive.includes(requiredEntry)) {
  console.error("VSIX is missing pi-extensions/qcode-bridge.ts");
  process.exitCode = 1;
  return;
}
console.log(`Verified bundled qcode bridge in ${path.basename(vsixPath)}`);
