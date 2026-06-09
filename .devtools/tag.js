#!/usr/bin/env node

/* TAG.JS
 *
 * This script makes tags and bumps the version.
 * Used only by the GitHub Actions workflow.
 *
 * Usage:
 *   --dry    Preview next version without making changes
 *   --rc     Create a release candidate tag (dev branch)
 *   --final  Create a final release tag (master branch)
 * */

import { readFileSync } from "fs";
import { execSync } from "child_process";

const mode = process.argv[2];

// -------------------- HELPERS --------------------

function sh(cmd) {
  return execSync(cmd, { stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
}

function readPackageVersion() {
  return JSON.parse(readFileSync("./package.json", "utf8")).version;
}

// -------------------- GIT --------------------

function getLastTag() {
  try {
    return sh("git describe --tags --abbrev=0");
  } catch {
    return null;
  }
}

function getCommits(fromTag) {
  const range = fromTag ? `${fromTag}..HEAD` : "HEAD";
  return sh(`git log ${range} --pretty=format:"- %h %s"`);
}

function getRcTags(base) {
  // Uses exact anchor (^v?) to avoid matching longer versions (e.g. 13.0.7 matching 3.0.7)
  const clean = base.replace(/^v/, "");
  const raw = sh(`git tag --list`);
  return raw
    .split("\n")
    .filter(Boolean)
    .filter(t => new RegExp(`^v?${clean.replace(/\./g, "\\.")}-rc\\.\\d+$`).test(t));
}

function nextRcNumber(base) {
  const tags = getRcTags(base);
  const nums = tags
    .map(t => Number(t.match(/-rc\.(\d+)$/)?.[1] || 0))
    .filter(n => n > 0);
  return nums.length > 0 ? Math.max(...nums) + 1 : 1;
}

// -------------------- VERSIONING --------------------

function detectBump(commits) {
  let hasMajor = false;
  let hasMinor = false;
  let hasPatch = false;

  for (const line of commits.split("\n")) {
    if (line.includes("BREAKING CHANGE")) { hasMajor = true; continue; }
    if (!line.includes(":")) continue;

    const header = line.split(":")[0];
    if (header.endsWith("!")) { hasMajor = true; continue; }
    if (/^- [a-f0-9]+ feat(\([^)]+\))?:/.test(line)) hasMinor = true;
    if (/^- [a-f0-9]+ fix(\([^)]+\))?:/.test(line)) hasPatch = true;
  }

  if (hasMajor) return "major";
  if (hasMinor) return "minor";
  if (hasPatch) return "patch";
  return "none";
}

function incVersion(version, type) {
  const [maj, min, pat] = version.replace(/^v/, "").split(".").map(Number);
  if (type === "major") return `${maj + 1}.0.0`;
  if (type === "minor") return `${maj}.${min + 1}.0`;
  if (type === "patch") return `${maj}.${min}.${pat + 1}`;
  return version;
}

// Strips RC suffix and optionally bumps the version.
function getBaseVersion(lastTag, bump) {
  if (!lastTag) return "0.0.1";
  const clean = lastTag.replace(/^v/, "").replace(/-rc\.\d+$/, "");
  return bump === "none" ? clean : incVersion(clean, bump);
}

// Returns the higher of two semver strings (ignores RC suffix).
function semverGte(a, b) {
  const pa = a.replace(/^v/, "").split("-")[0].split(".").map(Number);
  const pb = b.replace(/^v/, "").split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return true;
}

// Guards against the generated version going below what's in package.json.
function maxVersion(generated, pkg) {
  if (!semverGte(generated, pkg)) {
    console.log(`[VERSION GUARD] Generated ${generated} < package.json ${pkg}. Using ${pkg}.`);
    return pkg;
  }
  return generated;
}

// -------------------- COMMANDS --------------------

function runDry() {
  const lastTag = getLastTag();
  const commits = getCommits(lastTag);
  const bump = detectBump(commits);
  const base = maxVersion(getBaseVersion(lastTag, bump), readPackageVersion());

  const rcMatch = lastTag?.replace(/^v/, "").match(/^(.+)-rc\.\d+$/);
  let nextTag;

  if (rcMatch && rcMatch[1] === base) {
    nextTag = `${base}-rc.${nextRcNumber(base)}`;
  } else {
    nextTag = `${base}-rc.1`;
  }

  const current = readPackageVersion();

  const version = maxVersion(
    getBaseVersion(lastTag, bump),
    current
  );
  
  const alreadyApplied = current === version;

  console.log("\n[DRY RUN]");
  console.log("Last tag        :", lastTag ?? "(none)");
  console.log("Bump            :", bump);
  console.log("Next base       :", base);
  console.log("Next RC         :", nextTag);
  console.log("Current version :", current);
  console.log("Already applied :", alreadyApplied);
}

function runRc() {
  const lastTag = getLastTag();
  const rcMatch = lastTag?.replace(/^v/, "").match(/^(.+)-rc\.\d+$/);

  let base;

  if (rcMatch) {
    // Continuing an existing RC series — don't re-bump
    base = maxVersion(rcMatch[1], readPackageVersion());
    console.log(`\n[CONTINUING RC SERIES] Base: ${base}`);
  } else {
    // First RC after a stable release — detect bump from commits
    const commits = getCommits(lastTag);
    const bump = detectBump(commits);
    if (bump === "none") {
      console.log("⏭ Nothing to release (no feat/fix/breaking commits). Skipping.");
      process.exit(0);
    }
    base = maxVersion(getBaseVersion(lastTag, bump), readPackageVersion());
    console.log(`\n[NEW RC SERIES] Last tag: ${lastTag ?? "(none)"}, Base: ${base}`);
  }

  const rcNumber = nextRcNumber(base);
  const tag = `${base}-rc.${rcNumber}`;

  const current = readPackageVersion();

  if (current === version) {
    console.log(`Version already applied, making tag ${tag} with Git.`);
    execSync(`git tag ${tag}`)
    return;
  }

  console.log("Creating tag:", tag);
  execSync(`npm version ${tag} --yes`, { stdio: "inherit" });

  console.log(`✅ RC tag created: v${tag}`);
}

function runFinal() {
  const lastTag = getLastTag();
  const commits = getCommits(lastTag);
  const bump = detectBump(commits);

  if (bump === "none") {
    console.log("⏭ Nothing to release (no feat/fix/breaking commits). Skipping.");
    process.exit(0);
  }

  const version = maxVersion(getBaseVersion(lastTag, bump), readPackageVersion());

  console.log("\n[FINAL RELEASE]");
  console.log("Version:", version);

  const current = readPackageVersion();

  if (current === version) {
    console.log(`Version already applied, making tag ${version} with Git.`);
    execSync(`git tag ${version}`)
    return;
  }

  execSync(`npm version ${version} --yes`, { stdio: "inherit" });

  console.log(`✅ Release tag created: v${version}`);
}

// -------------------- ROUTER --------------------

switch (mode) {
  case "--dry":   runDry();   break;
  case "--rc":    runRc();    break;
  case "--final": runFinal(); break;
  default:
    console.log("Usage:\n  node tag.js --dry\n  node tag.js --rc\n  node tag.js --final");
    process.exit(1);
}
