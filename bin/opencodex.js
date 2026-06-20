#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");
const cli = path.join(root, "src", "cli.ts");

const result = spawnSync("bun", [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  if (result.error.code === "ENOENT") {
    console.error("opencodex requires Bun. Install it from https://bun.sh and make sure `bun` is on PATH.");
    process.exit(127);
  }
  console.error(result.error.message);
  process.exit(1);
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

if (result.signal) {
  console.error(`opencodex exited from signal ${result.signal}`);
}
process.exit(1);
