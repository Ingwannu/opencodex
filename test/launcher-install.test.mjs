import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "bin", "codex-multicodex.js");

function writeFakeCodex(filePath, markerPath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> ${JSON.stringify(markerPath)}
if [[ "\${1:-}" == "debug" && "\${2:-}" == "models" ]]; then
  cat <<'JSON'
{"models":[{"slug":"gpt-5.5","display_name":"GPT 5.5","supported_reasoning_levels":[{"effort":"medium"}],"service_tiers":[{"id":"priority","name":"Fast"}]}]}
JSON
  exit 0
fi
if [[ "\${1:-}" == "--version" ]]; then
  echo "fake-codex 1.0.0"
  exit 0
fi
echo "fake-codex $*"
`,
    { mode: 0o755 },
  );
  fs.chmodSync(filePath, 0o755);
}

function writeFakeWindowsCodex(filePath, markerPath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `@echo off\r\n` +
      `echo %*>>"${markerPath}"\r\n` +
      `if "%1"=="debug" if "%2"=="models" echo {"models":[{"slug":"gpt-5.5","display_name":"GPT 5.5","supported_reasoning_levels":[{"effort":"medium"}],"service_tiers":[{"id":"priority","name":"Fast"}]}]}& exit /b 0\r\n` +
      `if "%1"=="--version" echo fake-codex 1.0.0& exit /b 0\r\n` +
      `echo fake-codex %*\r\n`,
    { mode: 0o755 },
  );
  fs.chmodSync(filePath, 0o755);
}

test("install writes launchers that call the detected real Codex binary", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-launcher-"));
  const home = path.join(dir, "home");
  const binDir = path.join(home, ".local", "bin");
  const fakeBin = path.join(dir, "real-bin");
  const markerPath = path.join(dir, "fake-codex-calls.log");
  const fakeCodex = path.join(fakeBin, "codex");
  writeFakeCodex(fakeCodex, markerPath);

  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: path.join(home, ".codex"),
    CODEX_MULTICODEX_BIN_DIR: binDir,
    MULTICODEX_PORT: String(18000 + Math.floor(Math.random() * 1000)),
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
  };

  const installOutput = execFileSync(process.execPath, [cli, "install"], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  assert.match(installOutput, /Installed wrappers/);

  const manifest = JSON.parse(fs.readFileSync(path.join(home, ".codex", "opencodex", "manifest.json"), "utf8"));
  assert.equal(manifest.codexRealBin, fakeCodex);

  const codexOutput = execFileSync(path.join(binDir, "codex"), ["--version"], {
    cwd: root,
    env: {
      ...env,
      PATH: `${binDir}${path.delimiter}${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
    },
    encoding: "utf8",
  });
  assert.match(codexOutput, /fake-codex 1\.0\.0/);

  const calls = fs.readFileSync(markerPath, "utf8");
  assert.match(calls, /debug models --bundled/);
  assert.match(calls, /debug models/);
  assert.match(calls, /--version/);
  assert.doesNotMatch(calls, /--profile oai --version/);
});

test("doctor reports stale managed launchers and install rewrites them", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-stale-launcher-"));
  const home = path.join(dir, "home");
  const binDir = path.join(home, ".local", "bin");
  const fakeBin = path.join(dir, "real-bin");
  const markerPath = path.join(dir, "fake-codex-calls.log");
  const fakeCodex = path.join(fakeBin, "codex");
  writeFakeCodex(fakeCodex, markerPath);

  fs.mkdirSync(binDir, { recursive: true });
  const staleRoot = path.join(dir, "old-multicodex-proxy");
  fs.writeFileSync(
    path.join(binDir, "codex"),
    `#!/usr/bin/env bash
# codex-multicodex managed shim v1
set -euo pipefail
REAL="\${CODEX_REAL_BIN:-${fakeCodex}}"
ROOT="\${MULTICODEX_ROOT:-${staleRoot}}"
exec "$REAL" "$@"
`,
    { mode: 0o755 },
  );

  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: path.join(home, ".codex"),
    CODEX_MULTICODEX_BIN_DIR: binDir,
    MULTICODEX_PORT: String(19000 + Math.floor(Math.random() * 1000)),
    PATH: `${binDir}${path.delimiter}${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
  };

  const doctorOutput = execFileSync(process.execPath, [cli, "doctor"], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  assert.match(doctorOutput, /codex_wrapper: managed-stale/);
  assert.match(doctorOutput, new RegExp(`root=${staleRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  execFileSync(process.execPath, [cli, "install"], {
    cwd: root,
    env,
    encoding: "utf8",
  });

  const rewritten = fs.readFileSync(path.join(binDir, "codex"), "utf8");
  assert.match(rewritten, /--profile multicodex/);
  assert.doesNotMatch(rewritten, new RegExp(staleRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const rewrittenMulti = fs.readFileSync(path.join(binDir, "codex-multi"), "utf8");
  assert.match(rewrittenMulti, new RegExp(`MULTICODEX_ROOT:-${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.doesNotMatch(rewrittenMulti, new RegExp(staleRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("default codex launcher uses the unified MultiCodex profile", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-launcher-fallback-"));
  const home = path.join(dir, "home");
  const binDir = path.join(home, ".local", "bin");
  const fakeBin = path.join(dir, "real-bin");
  const markerPath = path.join(dir, "fake-codex-calls.log");
  const fakeCodex = path.join(fakeBin, "codex");
  writeFakeCodex(fakeCodex, markerPath);

  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: path.join(home, ".codex"),
    CODEX_MULTICODEX_BIN_DIR: binDir,
    MULTICODEX_PORT: String(20000 + Math.floor(Math.random() * 1000)),
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
  };

  execFileSync(process.execPath, [cli, "install"], {
    cwd: root,
    env,
    encoding: "utf8",
  });

  const result = spawnSync(path.join(binDir, "codex"), ["hello"], {
    cwd: root,
    env: {
      ...env,
      MULTICODEX_PORT: String(21000 + Math.floor(Math.random() * 1000)),
      PATH: `${binDir}${path.delimiter}${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fake-codex --profile multicodex hello/);
  const calls = fs.readFileSync(markerPath, "utf8");
  assert.match(calls, /--profile multicodex hello/);
});

test("default codex launcher respects an explicit profile without duplicating profile flags", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-launcher-explicit-profile-"));
  const home = path.join(dir, "home");
  const binDir = path.join(home, ".local", "bin");
  const fakeBin = path.join(dir, "real-bin");
  const markerPath = path.join(dir, "fake-codex-calls.log");
  const fakeCodex = path.join(fakeBin, "codex");
  writeFakeCodex(fakeCodex, markerPath);

  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: path.join(home, ".codex"),
    CODEX_MULTICODEX_BIN_DIR: binDir,
    MULTICODEX_PORT: String(20500 + Math.floor(Math.random() * 1000)),
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
  };

  execFileSync(process.execPath, [cli, "install"], {
    cwd: root,
    env,
    encoding: "utf8",
  });

  const result = spawnSync(path.join(binDir, "codex"), ["--profile", "multicodex", "hello"], {
    cwd: root,
    env: {
      ...env,
      PATH: `${binDir}${path.delimiter}${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fake-codex --profile multicodex hello/);
  assert.doesNotMatch(result.stdout, /--profile oai --profile multicodex/);
  const calls = fs.readFileSync(markerPath, "utf8");
  assert.match(calls, /--profile multicodex hello/);
  assert.doesNotMatch(calls, /--profile oai --profile multicodex/);
});

test("strict codex-multi launcher owns proxy startup for unified providers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-codex-multi-strict-"));
  const home = path.join(dir, "home");
  const binDir = path.join(home, ".local", "bin");
  const fakeBin = path.join(dir, "real-bin");
  const markerPath = path.join(dir, "fake-codex-calls.log");
  const fakeCodex = path.join(fakeBin, "codex");
  writeFakeCodex(fakeCodex, markerPath);

  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: path.join(home, ".codex"),
    CODEX_MULTICODEX_BIN_DIR: binDir,
    MULTICODEX_PORT: String(24000 + Math.floor(Math.random() * 1000)),
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
  };

  execFileSync(process.execPath, [cli, "install"], {
    cwd: root,
    env,
    encoding: "utf8",
  });

  assert.throws(
    () =>
      execFileSync(path.join(binDir, "codex-multi"), ["hello"], {
        cwd: root,
        env: {
          ...env,
          MULTICODEX_ROOT: path.join(dir, "missing-proxy-root"),
          MULTICODEX_PORT: String(25000 + Math.floor(Math.random() * 1000)),
          PATH: `${binDir}${path.delimiter}${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
        },
        encoding: "utf8",
      }),
    /MultiCodex proxy server not found/,
  );

  assert.equal(fs.existsSync(markerPath), true);
  const calls = fs.readFileSync(markerPath, "utf8");
  assert.doesNotMatch(calls, /--profile multicodex hello/);
});

test("install writes the app-visible default config to MultiCodex with Fast mode", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-default-config-"));
  const home = path.join(dir, "home");
  const binDir = path.join(home, ".local", "bin");
  const codexHome = path.join(home, ".codex");
  const fakeBin = path.join(dir, "real-bin");
  const markerPath = path.join(dir, "fake-codex-calls.log");
  const fakeCodex = path.join(fakeBin, "codex");
  writeFakeCodex(fakeCodex, markerPath);

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    `model_provider = "openai"
model = "gpt-5.5"
model_reasoning_effort = "high"

[features]
fast_mode = false
`,
  );

  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: codexHome,
    CODEX_MULTICODEX_BIN_DIR: binDir,
    MULTICODEX_PORT: String(22000 + Math.floor(Math.random() * 1000)),
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
  };

  execFileSync(process.execPath, [cli, "install"], {
    cwd: root,
    env,
    encoding: "utf8",
  });

  const config = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
  assert.match(config, /^model_provider = "multicodex"$/m);
  assert.match(config, /^model = "gpt-5\.5"$/m);
  assert.match(config, /^model_catalog_json = /m);
  assert.match(config, /^service_tier = "fast"$/m);
  assert.match(config, /^fast_mode = true$/m);
  assert.match(config, /^\[model_providers\.multicodex\]$/m);
});

test("install writes profile defaults that enable Codex Fast mode for OpenAI models", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-fast-profile-"));
  const home = path.join(dir, "home");
  const binDir = path.join(home, ".local", "bin");
  const codexHome = path.join(home, ".codex");
  const fakeBin = path.join(dir, "real-bin");
  const markerPath = path.join(dir, "fake-codex-calls.log");
  const fakeCodex = path.join(fakeBin, "codex");
  writeFakeCodex(fakeCodex, markerPath);

  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: codexHome,
    CODEX_MULTICODEX_BIN_DIR: binDir,
    MULTICODEX_PORT: String(22500 + Math.floor(Math.random() * 1000)),
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
  };

  execFileSync(process.execPath, [cli, "install"], {
    cwd: root,
    env,
    encoding: "utf8",
  });

  const oaiProfile = fs.readFileSync(path.join(codexHome, "oai.config.toml"), "utf8");
  const multiProfile = fs.readFileSync(path.join(codexHome, "multicodex.config.toml"), "utf8");
  assert.match(oaiProfile, /^service_tier = "fast"$/m);
  assert.match(multiProfile, /^service_tier = "fast"$/m);
  assert.match(oaiProfile, /^fast_mode = true$/m);
  assert.match(multiProfile, /^fast_mode = true$/m);
});

test("doctor reports MultiCodex catalog entries even when the default Codex config stays OpenAI", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-doctor-catalog-"));
  const home = path.join(dir, "home");
  const binDir = path.join(home, ".local", "bin");
  const codexHome = path.join(home, ".codex");
  const fakeBin = path.join(dir, "real-bin");
  const markerPath = path.join(dir, "fake-codex-calls.log");
  const fakeCodex = path.join(fakeBin, "codex");
  writeFakeCodex(fakeCodex, markerPath);

  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    `model_provider = "openai"
model = "gpt-5.5"
`,
  );

  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: codexHome,
    CODEX_MULTICODEX_BIN_DIR: binDir,
    MULTICODEX_PORT: String(23000 + Math.floor(Math.random() * 1000)),
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
  };

  execFileSync(process.execPath, [cli, "install"], {
    cwd: root,
    env,
    encoding: "utf8",
  });

  const doctorOutput = execFileSync(process.execPath, [cli, "doctor"], {
    cwd: root,
    env,
    encoding: "utf8",
  });

  assert.match(doctorOutput, /config_multicodex_default: true/);
  assert.match(doctorOutput, /glm-5\.2-fast: \{"visibility":"list"/);
  assert.match(doctorOutput, /kimi-k2\.7-code: \{"visibility":"list"/);
});

test("packed npm install writes runnable codex launchers without proxy startup", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-packed-install-"));
  const home = path.join(dir, "home");
  const binDir = path.join(home, ".local", "bin");
  const codexHome = path.join(home, ".codex");
  const npmPrefix = path.join(dir, "npm-prefix");
  const packDir = path.join(dir, "pack");
  const fakeBin = path.join(dir, "real-bin");
  const markerPath = path.join(dir, "fake-codex-calls.log");
  const fakeCodex = path.join(fakeBin, "codex");
  writeFakeCodex(fakeCodex, markerPath);
  fs.mkdirSync(packDir, { recursive: true });

  const packOutput = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", packDir],
    { cwd: root, encoding: "utf8" },
  );
  const packed = JSON.parse(packOutput)[0];
  const tarball = path.join(packDir, packed.filename);

  execFileSync(
    "npm",
    ["install", "-g", tarball, "--prefix", npmPrefix, "--ignore-scripts", "--no-audit", "--fund=false"],
    { cwd: root, encoding: "utf8" },
  );

  const installedOpencodex = path.join(npmPrefix, "bin", "opencodex");
  const port = String(26000 + Math.floor(Math.random() * 1000));
  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: codexHome,
    CODEX_MULTICODEX_BIN_DIR: binDir,
    MULTICODEX_PORT: port,
    PATH: `${fakeBin}${path.delimiter}${path.join(npmPrefix, "bin")}${path.delimiter}${process.env.PATH || ""}`,
  };

  try {
    const installOutput = execFileSync(installedOpencodex, ["install"], {
      cwd: root,
      env,
      encoding: "utf8",
    });
    assert.match(installOutput, /Installed wrappers/);

    const doctorOutput = execFileSync(installedOpencodex, ["doctor"], {
      cwd: root,
      env,
      encoding: "utf8",
    });
    assert.match(doctorOutput, /codex_wrapper: managed/);
    assert.doesNotMatch(doctorOutput, /managed-stale/);

    const codexVersion = execFileSync(path.join(binDir, "codex"), ["--version"], {
      cwd: root,
      env: {
        ...env,
        PATH: `${binDir}${path.delimiter}${env.PATH}`,
      },
      encoding: "utf8",
    });
    assert.match(codexVersion, /fake-codex 1\.0\.0/);

    const codexPrompt = execFileSync(path.join(binDir, "codex"), ["hello"], {
      cwd: root,
      env: {
        ...env,
        PATH: `${binDir}${path.delimiter}${env.PATH}`,
      },
      encoding: "utf8",
    });
    assert.match(codexPrompt, /fake-codex --profile multicodex hello/);
  } finally {
    spawnSync(installedOpencodex, ["uninstall"], {
      cwd: root,
      env,
      encoding: "utf8",
    });
  }
});

test("windows install writes executable cmd launchers and removes extensionless bash shims", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencodex-windows-launcher-"));
  const home = path.join(dir, "home");
  const binDir = path.join(home, ".local", "bin");
  const fakeBin = path.join(dir, "real-bin");
  const markerPath = path.join(dir, "fake-codex-calls.log");
  const fakeCodex = path.join(fakeBin, "codex.cmd");
  writeFakeWindowsCodex(fakeCodex, markerPath);

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "codex"), "#!/usr/bin/env bash\n# codex-multicodex managed shim v1\n", {
    mode: 0o755,
  });

  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: path.join(home, ".codex"),
    CODEX_MULTICODEX_BIN_DIR: binDir,
    CODEX_MULTICODEX_PLATFORM: "win32",
    CODEX_REAL_BIN: fakeCodex,
    MULTICODEX_PORT: String(27000 + Math.floor(Math.random() * 1000)),
    PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
  };

  const installOutput = execFileSync(process.execPath, [cli, "install"], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  assert.match(installOutput, /Installed wrappers/);

  assert.equal(fs.existsSync(path.join(binDir, "codex")), false);
  assert.equal(fs.existsSync(path.join(binDir, "codex.cmd")), true);
  assert.equal(fs.existsSync(path.join(binDir, "codex.ps1")), true);

  const cmd = fs.readFileSync(path.join(binDir, "codex.cmd"), "utf8");
  assert.match(cmd, /codex-multicodex\.js/);
  assert.match(cmd, /__opencodex-launcher/);

  const config = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
  assert.match(config, /^model_provider = "multicodex"$/m);
  assert.match(config, /^service_tier = "fast"$/m);

  const doctorOutput = execFileSync(process.execPath, [cli, "doctor"], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  assert.match(doctorOutput, /config_multicodex_default: true/);
});
