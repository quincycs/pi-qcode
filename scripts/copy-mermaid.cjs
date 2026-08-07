#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "node_modules", "mermaid", "dist", "mermaid.min.js");
const destination = path.join(root, "media", "vendor", "mermaid.min.js");

if (!fs.existsSync(source)) {
  console.error("Unable to find Mermaid's browser bundle. Run npm install before compiling.");
  process.exitCode = 1;
  return;
}

fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.copyFileSync(source, destination);
console.log(`Copied Mermaid browser bundle to ${path.relative(root, destination)}`);
