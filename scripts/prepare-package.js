#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function chmodIfExists(relativePath, mode) {
  const target = path.join(root, relativePath);
  if (fs.existsSync(target)) fs.chmodSync(target, mode);
}

function chmodTree(relativePath) {
  const target = path.join(root, relativePath);
  if (!fs.existsSync(target)) return;

  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) {
      fs.chmodSync(child, 0o755);
      chmodTree(path.relative(root, child));
    } else if (entry.isFile()) {
      fs.chmodSync(child, 0o644);
    }
  }
}

chmodIfExists("bin/codex-multicodex.js", 0o755);
chmodIfExists("README.md", 0o644);
chmodIfExists("PUBLISHING.md", 0o644);
chmodIfExists("package.json", 0o644);

for (const directory of ["dist", "web-dist"]) {
  chmodIfExists(directory, 0o755);
  chmodTree(directory);
}
