#!/usr/bin/env node

/* TAG.JS
 *
 * This script make tags and creates changelog
 * It is used only the github actions workflow 
 *
 * */


import { existsSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const mode = process.argv[2];
const arg = process.argv[3];
const date = new Date().toISOString().split("T")[0];

// -------------------- GIT --------------------

function sh(cmd) {
  return execSync(cmd).toString().trim();
}

if (!existsSync('./package.json')) {
  console.error('package.json not found');
  process.exit(1);
}

try {
  sh('git rev-parse --git-dir');
} catch {
  console.error('This is not git repository');
  process.exit(1);
}

const status = sh('git status --porcelain');
if (status) {
  console.error('Dirty working tree. Commit your changes or stash them.');
  process.exit(1);
}

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
  try {
    return sh(`git tag --list "${base}-rc.*"`).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

// -------------------- VERSIONING --------------------

function detectBump(commits) {
  const lines = commits.split("\n");
  
  for (const l of lines) {
    // 1. Verifica Breaking Change explícito
    if (l.includes("BREAKING CHANGE")) return "major";
    
    // 2. Verifica o cabeçalho (ex: "fix!", "feat(scope)!", "chore!")
    // Pega tudo até o primeiro ":"
    const header = l.split(":")[0];
    
    // Se o cabeçalho termina com "!", é breaking change
    if (header.endsWith("!")) return "major";
    
    // 3. Verifica Feature (Minor)
    // Deve começar com "feat" e ter ":" (opcionalmente com scope)
    if (/^feat(\([^)]+\))?!?:/.test(l)) return "minor";
  }
  
  return "patch";
}

function incVersion(version, type) {
  const [maj, min, pat] = version.split(".").map(Number);

  if (type === "major") return `${maj + 1}.0.0`;
  if (type === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

function getBaseVersion(lastTag, bump) {
  if (!lastTag) return "0.0.1";

  const clean = lastTag.replace(/-rc\.\d+/, "");
  return incVersion(clean, bump);
}

// -------------------- RC ENGINE ----------------------

function nextRc(base) {
  const tags = getRcTags(base);

  if (tags.length === 0) return 1;

  const nums = tags
    .map(t => Number(t.match(/-rc\.(\d+)$/)?.[1] || 0))
    .filter(n => n > 0);

  return Math.max(...nums) + 1;
}

// -------------------- LOG / FILES --------------------

function generateLog(fromTag) {
  const range = fromTag ? `${fromTag}..HEAD` : "";
  return sh(`git log ${range} --pretty=format:"- %h %s"`);
}

function updateChangelog(version, log) {
  const entry = `
## [${version}] - ${date}

${log}

`;

  writeFileSync("CHANGELOG.md", entry);
}

// -------------------- COMMANDS --------------------

function runDry() {
  const lastTag = getLastTag();
  const commits = getCommits(lastTag);

  const bump = detectBump(commits);
  const base = getBaseVersion(lastTag, bump);

  console.log("\n[DRY RUN]");
  console.log("Last tag:", lastTag);
  console.log("Bump:", bump);
  console.log("Next stable:", base);
}

function runRc() {
  const lastTag = getLastTag();
  const commits = getCommits(lastTag);

  const bump = detectBump(commits);
  const base = getBaseVersion(lastTag, bump);

  const rc = nextRc(base);
  const tag = `${base}-rc.${rc}`;

  console.log("\n[APPLY CHANGES]");
  console.log("Creating tag:", tag);

  execSync(`git tag ${tag}`);
  
  execSync(`npm version ${tag} --no-git-tag-version --yes`);
  
  const log = generateLog(tag);
  updateChangelog(tag, log);

  console.log("✅ Tag, versão e changelog atualizados.");
}

function runFinal() {
  const lastTag = getLastTag();
  const commits = getCommits(lastTag);
  const bump = detectBump(commits);
  const version = getBaseVersion(lastTag, bump);  // Calcular versão, não pedir argumento
  
  console.log("\n[FINAL RELEASE]");
  console.log("Version:", version);
  
  execSync(`git tag ${version}`);
  execSync(`npm version ${version} --no-git-tag-version --yes`);  // Usar npm version
  
  const log = generateLog(lastTag);
  updateChangelog(version, log);
  
  console.log("Released:", version);
}

// -------------------- ROUTER --------------------

switch (mode) {
  case "--dry":
    runDry();
    break;

  case "--rc":
    runRc();
    break;

  case "--final":
    runFinal();
    break;

  default:
    console.log(`
Usage:
  --dry
  --rc
  --final
`);
}
