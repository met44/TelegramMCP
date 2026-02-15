#!/usr/bin/env node
// Builds the distributable single-file installer by embedding server.js as base64
const fs = require("fs");
const path = require("path");

const serverCode = fs.readFileSync(path.join(__dirname, "server.js"), "utf-8");
const b64 = Buffer.from(serverCode).toString("base64");

const installer = fs.readFileSync(path.join(__dirname, "install.js"), "utf-8");
const output = installer.replace("%%SERVER_B64%%", b64);

const outPath = path.join(__dirname, "dist", "telegram-mcp-install.js");
fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
fs.writeFileSync(outPath, output);

console.log(`Built: ${outPath}`);
console.log(`Server.js: ${serverCode.length} bytes -> ${b64.length} base64 chars`);
console.log(`Installer: ${output.length} bytes total`);
console.log(`\nDistribute this single file. Run with: node telegram-mcp-install.js`);
