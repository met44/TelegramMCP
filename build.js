#!/usr/bin/env node
// Builds the distributable single-file installer by embedding server.js as base64
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const serverCode = fs.readFileSync(path.join(__dirname, "server.js"), "utf-8");
const b64 = Buffer.from(serverCode).toString("base64");
const sha256 = crypto.createHash("sha256").update(serverCode).digest("hex");

const installer = fs.readFileSync(path.join(__dirname, "install.js"), "utf-8");
const output = installer.replace("%%SERVER_B64%%", b64);

const outPath = path.join(__dirname, "dist", "telegram-mcp-install.js");
fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
fs.writeFileSync(outPath, output);

// Write checksum file for verification
fs.writeFileSync(path.join(__dirname, "dist", "server.js.sha256"), sha256 + "  server.js\n");

console.log(`Built: ${outPath}`);
console.log(`Server.js: ${serverCode.length} bytes -> ${b64.length} base64 chars`);
console.log(`SHA-256:   ${sha256}`);
console.log(`Installer: ${output.length} bytes total`);
console.log(`\nDistribute this single file. Run with: node telegram-mcp-install.js`);
console.log(`Verify embedded code: node -e "const c=require('fs').readFileSync('dist/telegram-mcp-install.js','utf-8');const m=c.match(/SERVER_B64 = \\"([A-Za-z0-9+\\/=]+)\\"/);console.log(require('crypto').createHash('sha256').update(Buffer.from(m[1],'base64')).digest('hex'))"`);
