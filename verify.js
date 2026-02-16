#!/usr/bin/env node
// Verifies that the base64-embedded server.js in the distributable matches the source
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const distFile = path.join(__dirname, "dist", "telegram-mcp-install.js");
const checksumFile = path.join(__dirname, "dist", "server.js.sha256");
const sourceFile = path.join(__dirname, "server.js");

if (!fs.existsSync(distFile)) {
  console.error("dist/telegram-mcp-install.js not found — run `npm run build` first");
  process.exit(1);
}

// Hash the source server.js
const sourceHash = crypto.createHash("sha256")
  .update(fs.readFileSync(sourceFile, "utf-8"))
  .digest("hex");

// Extract and hash the embedded base64
const content = fs.readFileSync(distFile, "utf-8");
const match = content.match(/SERVER_B64 = "([A-Za-z0-9+/=]+)"/);
if (!match) {
  console.error("Could not find embedded base64 in distributable");
  process.exit(1);
}
const embeddedHash = crypto.createHash("sha256")
  .update(Buffer.from(match[1], "base64"))
  .digest("hex");

console.log(`Source server.js:   ${sourceHash}`);
console.log(`Embedded (base64):  ${embeddedHash}`);

if (sourceHash === embeddedHash) {
  console.log("\n✔ MATCH — embedded code is identical to server.js");
} else {
  console.error("\n✘ MISMATCH — embedded code differs from server.js! Rebuild with: npm run build");
  process.exit(1);
}
