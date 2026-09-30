#!/usr/bin/env node
// M2 assemble-release body composer (fork-owned; used by fork-release.yml's
// workflow_dispatch assembly job to rebuild the release body AFTER assets were
// uploaded, so the latest-pointer table reflects the real asset set).
//
// sha256 sources (searched recursively under --sha-dir): per-file `<name>.sha256`
// sidecars and electron-builder `SHA256SUMS.txt` manifests. Assets with no
// discoverable sha render "—" (never a fabricated digest).
//
// usage: node assemble-body.mjs --assets-json a.json --sha-dir art --out body.md \
//        --version 0.10.2-go.6 --tag v0.10.2-go.6 --repo owner/name
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (n) => {
  const i = args.indexOf(n);
  if (i === -1) throw new Error(`missing ${n}`);
  return args[i + 1];
};
const assetsJson = flag("--assets-json");
const shaDir = flag("--sha-dir");
const out = flag("--out");
const version = flag("--version");
const tag = flag("--tag");
const repo = flag("--repo");

function walk(dir) {
  const acc = [];
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) acc.push(...walk(p));
    else acc.push(p);
  }
  return acc;
}

// name -> sha256, from every sidecar + SHA256SUMS.txt under shaDir
const shaByName = new Map();
for (const f of walk(shaDir)) {
  const text = readFileSync(f, "utf8");
  if (f.endsWith(".sha256")) {
    for (const line of text.split(/\r?\n/)) {
      const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/);
      if (m) shaByName.set(path.basename(m[2]), m[1]);
    }
  } else if (/SHA256SUMS.txt$/.test(path.basename(f))) {
    for (const line of text.split(/\r?\n/)) {
      const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/);
      if (m) shaByName.set(path.basename(m[2]), m[1]);
    }
  }
}

const assets = JSON.parse(readFileSync(assetsJson, "utf8")).assets
  .map((a) => a.name)
  .filter((n) => !/\.(sha256|blockmap|yml)$/.test(n));

const base = `https://github.com/${repo}/releases/download/${tag}`;
const lines = [];
for (const n of assets.sort()) {
  const s = shaByName.get(n) ?? "—";
  let how = "—";
  if (n.endsWith(".tgz")) how = `\`npm i -g ${base}/${n}\``;
  else if (n.endsWith(".apk")) how = `adb install -r \`${n}\` (arm64)`;
  else if (/\.(exe|zip|deb|rpm|AppImage|tar\.gz)$/.test(n)) how = "桌面安装包（未签名）";
  lines.push(`| ${n} | ${how} | \`${s}\` |`);
}

const body = `# Paseo Go ${version}

**产物直链清单（latest pointer — 本 release 即最新成品包）**

| 产物 | 安装/使用 | sha256 |
|---|---|---|
${lines.join("\n")}

## 说明

- macOS 产物：本轮不出（无 Apple 公证凭据）。
- Windows/Linux 桌面产物未签名（上游本就不签 win/linux；SmartScreen/包管理器警告预期内）。
- APK 签名 = React Native 模板 debug keystore（与既往 go 构建升级兼容；正式 keystore 待办见 BUILD.md）。
- CLI tarball 为全量 vendored 平台包：安装不访问 registry、不跑编译脚本。
- Windows zip 解包清单校验：见本 run 的 Assemble release 步骤日志（WIN-ZIP-MANIFEST-OK）。
`;
writeFileSync(out, body);
console.log(body);
