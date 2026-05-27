#!/usr/bin/env node

const fs = require("fs");
const { execSync } = require("child_process");

const version = process.argv[2];

if (!version) {
    console.error("uso: ./release.js 1.2.3");
    process.exit(1);
}

function updateJson(path) {
    const json = JSON.parse(fs.readFileSync(path, "utf8"));

    json.version = version;

    fs.writeFileSync(
        path,
        JSON.stringify(json, null, 2) + "\n"
    );
}

const date = new Date().toISOString().split("T")[0];

function getLastTag() {
    try {
        return execSync("git describe --tags --abbrev=0")
            .toString()
            .trim();
    } catch {
        return null;
    }
}

function generateLog(fromTag) {
    const range = fromTag
        ? `${fromTag}..HEAD`
        : "";

    return execSync(
        `git log ${range} --pretty=format:"- %h %s"`
    )
        .toString()
        .trim();
}

function updateChangelog(version) {
    const lastTag = getLastTag();
    const log = generateLog(lastTag);

    const entry = `
## [${version}] - ${date}
${log}

`;

    let current = "";

    if (fs.existsSync("CHANGELOG.md")) {
        current = fs.readFileSync(
            "CHANGELOG.md",
            "utf8"
        );
    } else {
        current =
`# Changelog

All notable changes to this project will be documented in this file.

`;
    }

    const updated = current.replace(
        /(# Changelog\s+All notable changes to this project will be documented in this file\.\s+)/,
        `$1${entry}`
    );

    fs.writeFileSync(
        "CHANGELOG.md",
        updated
    );
}

console.log("[1/4] Updating package.json...");
updateJson("./package.json");

console.log("[2/4] Updating package-lock.json...");
updateJson("./package-lock.json");

console.log("[3/4] Writing latest...");
fs.writeFileSync("./latest", version + "\n");

console.log("[4/4] Writing changelog...");
updateChangelog(version)

console.log(`
Next steps:

git diff
git add .
git commit -m "release: ${version}"
git tag ${version}
git pushall && git pushall --tags
`);
