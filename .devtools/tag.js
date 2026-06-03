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
  let hasMajor = false;
  let hasMinor = false;
  let hasPatch = false;

  for (const l of lines) {
    // 1. Major: BREAKING CHANGE ou ! no header
    if (l.includes("BREAKING CHANGE")) { hasMajor = true; continue; }
    
    if (l.includes(":")) {
      const header = l.split(":")[0];
      if (header.endsWith("!")) { hasMajor = true; continue; }
      
      // 2. Minor: feat
      if (/^feat(\([^)]+\))?!?:/.test(l)) hasMinor = true;
      
      // 3. Patch: fix
      if (/^fix(\([^)]+\))?!?:/.test(l)) hasPatch = true;
    }
  }

  if (hasMajor) return "major";
  if (hasMinor) return "minor";
  if (hasPatch) return "patch";
  return "none";
}

function incVersion(version, type) {
  const [maj, min, pat] = version.split(".").map(Number);
  if (type === "major") return `${maj + 1}.0.0`;
  if (type === "minor") return `${maj}.${min + 1}.0`;
  if (type === "patch") return `${maj}.${min}.${pat + 1}`;
  // Se for "none", retorna a versão original sem mudar
  return version; 
}

function getBaseVersion(lastTag, bump) {
  if (!lastTag) return "0.0.1";

  // LIMPEZA DO SUFIXO RC
  const clean = lastTag.replace(/-rc\.\d+$/, "");

  // SE NÃO HOUVER BUMP, RETORNA A BASE LIMPA SEM INCREMENTAR
  if (bump === "none") {
    return clean;
  }

  // SENÃO, APLICA O BUMP
  return incVersion(clean, bump);
}

// -------------------- LOG / FILES --------------------

function generateLog(fromTag) {
  const range = fromTag ? `${fromTag}..HEAD` : "";
  return sh(`git log ${range} --pretty=format:"- %h %s"`);
}

function updateChangelog(version, log) {
  const lines = log.split("\n").filter(l => l.trim());
  
  // Arrays para categorizar
  const breakingChanges = [];
  const features = [];
  const fixes = [];
  const others = []; // refactor, chore, build, docs, etc.

  lines.forEach(line => {
    // Remove o hash e o tipo inicial para analisar o conteúdo
    // Formato: "- abc1234 tipo: mensagem"
    const match = line.match(/^- [a-f0-9]+ (.+): (.+)$/);
    
    if (!match) {
      // Se não seguir o padrão, joga em "outros"
      others.push(line);
      return;
    }

    const [, type, message] = match;
    const cleanLine = `- ${message}`; // Formato limpo sem hash

    // 1. Verifica Breaking Change
    if (message.includes("BREAKING CHANGE") || type.endsWith("!")) {
      breakingChanges.push(cleanLine);
    } 
    // 2. Verifica Features
    else if (type.startsWith("feat")) {
      features.push(cleanLine);
    } 
    // 3. Verifica Fixes
    else if (type.startsWith("fix")) {
      fixes.push(cleanLine);
    } 
    // 4. Outros (refactor, chore, build, docs, style, perf, test)
    else {
      others.push(cleanLine);
    }
  });

  // Constrói o conteúdo do changelog
  let entry = `## [${version}] - ${date}\n\n`;

  if (breakingChanges.length > 0) {
    entry += "### ⚠️ Breaking Changes\n\n";
    entry += breakingChanges.join("\n") + "\n\n";
  }

  if (features.length > 0) {
    entry += "### ✨ Features\n\n";
    entry += features.join("\n") + "\n\n";
  }

  if (fixes.length > 0) {
    entry += "### 🐛 Bug Fixes\n\n";
    entry += fixes.join("\n") + "\n\n";
  }

  if (others.length > 0) {
    entry += "### 🛠 Other Changes\n\n";
    entry += others.join("\n") + "\n\n";
  }

  // Prepend no arquivo existente
  const current = existsSync("CHANGELOG.md")
    ? readFileSync("CHANGELOG.md", "utf8")
    : "# Changelog\n\n";

  writeFileSync("CHANGELOG.md", entry + current);
}

// -------------------- COMMANDS --------------------

function runDry() {
  const lastTag = getLastTag();
  const commits = getCommits(lastTag);

  const bump = detectBump(commits);
  let base = getBaseVersion(lastTag, bump);

  // Lógica extra para simular o próximo RC
  let nextTag = base;
  
  // Se a última tag era um RC, simulamos o próximo RC
  const rcMatch = lastTag ? lastTag.match(/^(.+)-rc\.\d+$/) : null;
  
  if (rcMatch) {
    const currentBase = rcMatch[1];
    // Se a base calculada é a mesma da tag anterior, continuamos a série RC
    if (currentBase === base) {
      const tags = getRcTags(currentBase);
      const nums = tags.map(t => Number(t.match(/-rc\.(\d+)$/)?.[1] || 0)).filter(n => n > 0);
      const nextRcNum = nums.length > 0 ? Math.max(...nums) + 1 : 1;
      nextTag = `${currentBase}-rc.${nextRcNum}`;
    } else {
      // Se a base mudou (ex: de 3.0.7 para 4.0.0), começamos um novo RC
      nextTag = `${base}-rc.1`;
    }
  } else {
    // Se a última tag não era RC, o próximo seria o primeiro RC da nova base
    nextTag = `${base}-rc.1`;
  }

  console.log("\n[DRY RUN]");
  console.log("Last tag:", lastTag);
  console.log("Bump:", bump);
  console.log("Next base:", base);
  console.log("Next RC tag:", nextTag); // <--- Nova linha
}

function runRc() {
  const lastTag = getLastTag();
  
  // 1. Detectar se a última tag é um RC da mesma série
  const rcMatch = lastTag ? lastTag.match(/^(.+)-rc\.\d+$/) : null;
  
  let base;
  let rcNumber;

  if (rcMatch) {
    // Se a última tag é um RC (ex: 4.0.0-rc.1), mantemos a base (4.0.0)
    base = rcMatch[1];
    
    // Calcula o próximo número do RC
    const tags = getRcTags(base);
    const nums = tags.map(t => Number(t.match(/-rc\.(\d+)$/)?.[1] || 0)).filter(n => n > 0);
    rcNumber = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    
    console.log(`\n[CONTINUING RC SERIES]`);
    console.log(`Base: ${base}, Next RC: ${rcNumber}`);
  } else {
    // Se a última tag NÃO é um RC (ex: 3.0.7), calculamos a nova base
    const commits = getCommits(lastTag);
    const bump = detectBump(commits);
    
    // Se bump for "none", a base não muda (mantém a última tag limpa)
    base = getBaseVersion(lastTag, bump);
    
    const tags = getRcTags(base);
    const nums = tags.map(t => Number(t.match(/-rc\.(\d+)$/)?.[1] || 0)).filter(n => n > 0);
    rcNumber = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    
    console.log(`\n[NEW RC SERIES]`);
    console.log(`Last tag: ${lastTag}, Bump: ${bump}, Base: ${base}`);
  }

  const tag = `${base}-rc.${rcNumber}`;
  console.log("Creating tag:", tag);
  
  execSync(`npm version ${tag} --yes`);

  const log = generateLog(lastTag);
  updateChangelog(tag, log);
  
  console.log("✅ Tag e versão atualizadas.");
}

function runFinal() {
  const lastTag = getLastTag();
  const commits = getCommits(lastTag);
  const bump = detectBump(commits);
  const version = getBaseVersion(lastTag, bump);  // Calcular versão, não pedir argumento
  
  console.log("\n[FINAL RELEASE]");
  console.log("Version:", version);
  
  execSync(`npm version ${version} --yes`);  // Usar npm version
  
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
