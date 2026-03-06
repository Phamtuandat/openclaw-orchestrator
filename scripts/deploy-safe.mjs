#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "fs";
import { resolve, join, relative } from "path";
import os from "os";

function parseArgs(argv) {
  const args = { source: ".openclaw/dist", target: "" };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--source" && argv[i + 1]) {
      args.source = argv[++i];
      continue;
    }
    if (token === "--target" && argv[i + 1]) {
      args.target = argv[++i];
      continue;
    }
    if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    }
    console.error(`[deploy-safe] Unknown argument: ${token}`);
    printHelp();
    process.exit(1);
  }
  if (!args.target) {
    args.target = join(os.homedir(), ".openclaw-orchestrator-runtime", "dist");
  }
  return args;
}

function printHelp() {
  console.log("Usage: node scripts/deploy-safe.mjs [--source <path>] [--target <path>]");
  console.log("Defaults:");
  console.log("  --source .openclaw/dist");
  console.log("  --target ~/.openclaw-orchestrator-runtime/dist");
}

function normalizeForMatch(absPath) {
  return absPath.replace(/\\/g, "/").toLowerCase();
}

function isForbiddenTarget(absPath) {
  const normalized = normalizeForMatch(absPath);
  return normalized.includes("/node_modules/openclaw/dist");
}

function main() {
  const { source, target } = parseArgs(process.argv.slice(2));
  const sourceAbs = resolve(source);
  const targetAbs = resolve(target);

  if (isForbiddenTarget(targetAbs)) {
    console.error(`[deploy-safe] Refusing to deploy into forbidden runtime path: ${targetAbs}`);
    console.error("[deploy-safe] Never deploy orchestrator artifacts into OpenClaw package dist.");
    process.exit(1);
  }

  if (!existsSync(sourceAbs) || !statSync(sourceAbs).isDirectory()) {
    console.error(`[deploy-safe] Source dist directory not found: ${sourceAbs}`);
    console.error("[deploy-safe] Run build first: npx tsc");
    process.exit(1);
  }

  const indexEntry = join(sourceAbs, "index.js");
  if (!existsSync(indexEntry)) {
    console.error(`[deploy-safe] Expected entry missing: ${indexEntry}`);
    process.exit(1);
  }

  mkdirSync(targetAbs, { recursive: true });
  rmSync(targetAbs, { recursive: true, force: true });
  mkdirSync(targetAbs, { recursive: true });
  cpSync(sourceAbs, targetAbs, { recursive: true });

  const manifest = {
    deployedAt: new Date().toISOString(),
    source: sourceAbs,
    target: targetAbs,
    cwd: process.cwd(),
    relativeTargetFromRepo: relative(process.cwd(), targetAbs),
  };
  writeFileSync(join(targetAbs, ".deploy-safe.json"), JSON.stringify(manifest, null, 2), "utf8");

  console.log("[deploy-safe] Deployment complete.");
  console.log(`[deploy-safe] Source: ${sourceAbs}`);
  console.log(`[deploy-safe] Target: ${targetAbs}`);
}

main();
