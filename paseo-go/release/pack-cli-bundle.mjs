#!/usr/bin/env node
// Paseo Go CLI tarball builder (M2 fork CI; paseo-go/BUILD.md pipeline chapter).
//
// Why this exists: `npm pack -w @getpaseo/cli` alone yields a tarball whose
// @getpaseo/* dependencies resolve to the PUBLIC npm registry — upstream code,
// not our fork (we have no @getpaseo scope). And a half-bundled tree (fork
// packages vendored, externals registry-resolved) breaks `npm i -g`: npm nests
// the new deps under the global package and fails to bin-link lifecycle-script
// deps (msgpackr-extract install ENOENT; reproduced twice on win11/npm 11.6).
//
// So we vendor the ENTIRE production tree:
//   1. `npm pack` the 7 fork workspace packages (prepack builds dist; server's
//      prepack also embeds the daemon web-ui export).
//   2. Fresh staging dir: `npm install --omit=dev <the 7 tgz>` — npm resolves
//      inter-@getpaseo pins to the local tarballs, pulls externals from the
//      registry and BUILDS native modules for the host platform (node-pty).
//   3. Final package = cli payload + the whole staged node_modules vendored via
//      bundleDependencies. The end user's `npm i -g <url>.tgz` then needs no
//      registry and runs no scripts: pure extraction + `paseo` bin link.
//
// Consequence: tarballs are PLATFORM+ARCH specific (win32-x64, linux-x64, …).
// The CI job builds the one matching its runner; the release body lists each
// platform's URL. This script must run on the target platform.
//
// Zero repo files are modified (all staging happens in a temp dir).
//
// usage: node paseo-go/release/pack-cli-bundle.mjs --version 0.10.2-go.1 --out <dir>
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  if (i === -1) throw new Error(`missing ${name}`);
  return args[i + 1];
}
const VERSION = flag("--version");
const OUT = path.resolve(flag("--out"));

const FORK_PACKAGES = ["cli", "client", "protocol", "server", "relay", "highlight", "plugin"];
const FORK_NAMES = FORK_PACKAGES.map((p) => `@getpaseo/${p}`);

// Node >=18.20 rejects .cmd shims via execFile (EINVAL); drive npm through
// its cli js next to the running node binary — identical on win and linux.
const NPM_CLI = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
function run(cmd, cmdArgs, opts = {}) {
  const [bin, argv] = cmd === "npm" ? [process.execPath, [NPM_CLI, ...cmdArgs]] : [cmd, cmdArgs];
  console.log(`$ ${bin} ${argv.join(" ")}`);
  return execFileSync(bin, argv, { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
}

const work = mkdtempSync(path.join(tmpdir(), "paseo-cli-bundle-"));
try {
  // 1. pack the fork workspace packages (prepack builds dist).
  const pkgsDir = path.join(work, "pkgs");
  mkdirSync(pkgsDir);
  const tgz = {};
  // PGO_IGNORE_SCRIPTS (local Windows only — upstream build-daemon-web-ui.mjs
  // spawn("npm", shell:false) ENOENTs off POSIX): pack from pre-built dist/.
  // The web-ui/native probes below still gate the output, so this cannot ship
  // a silently degraded tarball. CI never sets it.
  const packExtra = process.env.PGO_IGNORE_SCRIPTS === "1" ? ["--ignore-scripts"] : [];
  for (const name of FORK_NAMES) {
    run("npm", ["pack", "-w", name, ...packExtra, "--pack-destination", pkgsDir], { stdio: "inherit" });
  }
  for (const f of readdirSync(pkgsDir)) {
    const meta = JSON.parse(run("tar", ["-xOf", path.join(pkgsDir, f), "package/package.json"]));
    tgz[meta.name] = { file: path.join(pkgsDir, f), meta };
  }
  for (const name of FORK_NAMES) if (!tgz[name]) throw new Error(`missing packed tarball for ${name}`);

  // 2. staging install: local tarballs + registry externals, production only,
  //    scripts ON (native modules must match the host platform).
  const stage = path.join(work, "stage");
  mkdirSync(stage);
  writeFileSync(
    path.join(stage, "package.json"),
    JSON.stringify({ name: "paseo-cli-stage", version: "0.0.0", private: true }, null, 2),
  );
  run(
    "npm",
    ["install", "--omit=dev", "--no-audit", "--no-fund", ...FORK_NAMES.map((n) => `file:${tgz[n].file}`)],
    { cwd: stage, stdio: "inherit" },
  );
  const stageNm = path.join(stage, "node_modules");

  // Guard: staged fork packages must be OUR tarballs, not public registry
  // copies of the same version (fork ships server code upstream lacks).
  const forkMarker = path.join(stageNm, "@getpaseo", "server", "dist", "server", "server", "workspace", "commit-history.js");
  try {
    readFileSync(forkMarker);
  } catch {
    throw new Error(`staged @getpaseo/server is not the fork build (missing ${forkMarker})`);
  }

  // 3. final package: cli payload + the whole staged tree vendored.
  const final = path.join(work, "final");
  // bsdtar (Windows tar.exe) has no --transform; extract then rename.
  execFileSync("tar", ["-xzf", tgz["@getpaseo/cli"].file, "-C", work]);
  renameSync(path.join(work, "package"), final);
  const finalPkgPath = path.join(final, "package.json");
  const finalPkg = JSON.parse(readFileSync(finalPkgPath, "utf8"));
  delete finalPkg.scripts;

  // Move the staged tree in (drop .bin: host-built shims are meaningless for
  // consumers; only the root `paseo` bin gets linked by their npm).
  const vendored = path.join(final, "node_modules");
  rmSync(vendored, { recursive: true, force: true }); // cli tgz never carries node_modules
  cpSync(stageNm, vendored, { recursive: true });
  rmSync(path.join(vendored, ".bin"), { recursive: true, force: true });
  rmSync(path.join(vendored, ".package-lock.json"), { force: true });

  // every vendored top-level entry is declared as a dep (npm keeps bundled
  // copies for declared deps; scoped dirs expand to their members).
  const deps = {};
  const bundled = [];
  for (const entry of readdirSync(vendored)) {
    if (entry.startsWith(".")) continue;
    const dirs = entry.startsWith("@")
      ? readdirSync(path.join(vendored, entry)).map((sub) => `${entry}/${sub}`)
      : [entry];
    for (const full of dirs) {
      const pkgJson = JSON.parse(readFileSync(path.join(vendored, full, "package.json"), "utf8"));
      deps[full] = pkgJson.version;
      bundled.push(full);
    }
  }
  for (const name of FORK_NAMES) if (name !== "@getpaseo/cli") deps[name] = tgz[name].meta.version;
  finalPkg.version = VERSION;
  finalPkg.dependencies = { ...deps, ...Object.fromEntries(Object.entries(finalPkg.dependencies || {}).filter(([k]) => k.startsWith("@getpaseo/"))) };
  finalPkg.bundleDependencies = bundled;
  writeFileSync(finalPkgPath, `${JSON.stringify(finalPkg, null, 2)}\n`);

  mkdirSync(OUT, { recursive: true });
  const packed = run("npm", ["pack", "--pack-destination", OUT], { cwd: final, encoding: "utf8" }).trim();
  const outPath = path.join(OUT, packed.split("\n").pop());
  console.log(`tarball: ${outPath}`);
  const list = run("tar", ["-tzf", outPath]);

  // Prove the vendoring survived packing: fork code, web-ui export, the bin,
  // and at least one platform-built native (node-pty) must be inside.
  for (const probe of [
    "package/node_modules/@getpaseo/server/dist/server/",
    "package/node_modules/@getpaseo/server/dist/server/web-ui/index.html",
    "package/bin/paseo",
  ]) {
    if (!list.includes(probe)) throw new Error(`packed tarball missing ${probe}`);
  }
  if (!/node-pty\/(build|prebuilds)\/.*\.node/.test(list)) {
    throw new Error("packed tarball has no built node-pty native module (stage install scripts did not run?)");
  }
  console.log(`vendoring verified (${bundled.length} bundled entries)`);
  console.log(outPath);
} finally {
  rmSync(work, { recursive: true, force: true });
}
