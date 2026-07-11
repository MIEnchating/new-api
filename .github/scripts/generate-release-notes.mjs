import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const tag = process.argv[2] || process.env.GITHUB_REF_NAME;
const outputPath = process.argv[3] || "release-notes.md";

if (!tag) {
  throw new Error("Release tag is required");
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function getPreviousTag() {
  try {
    return git("describe", "--tags", "--abbrev=0", `${tag}^`);
  } catch {
    return "";
  }
}

function cleanSubject(subject) {
  return subject
    .replace(/^(feat|fix|perf|refactor|build|ci|docs|test|style|chore)(\([^)]*\))?!?:\s*/i, "")
    .replace(/\s*\(#\d+\)\s*$/, "")
    .trim();
}

function capitalize(value) {
  if (!value) return value;
  return value[0].toUpperCase() + value.slice(1);
}

function formatEntry(commit, repository) {
  const title = capitalize(cleanSubject(commit.subject));
  const shortHash = commit.hash.slice(0, 8);
  if (!repository) return `- ${title} (${shortHash})`;
  return `- ${title} ([${shortHash}](https://github.com/${repository}/commit/${commit.hash}))`;
}

const previousTag = getPreviousTag();
const range = previousTag ? `${previousTag}..${tag}` : tag;
const repository = process.env.GITHUB_REPOSITORY || "";
const rawLog = git("log", "--no-merges", "--pretty=format:%H%x09%s", range);
const commits = rawLog
  ? rawLog.split("\n").map((line) => {
      const [hash, ...subjectParts] = line.split("\t");
      return { hash, subject: subjectParts.join("\t") };
    })
  : [];

const features = commits.filter((commit) => /^feat(\([^)]*\))?!?:/i.test(commit.subject));
const fixes = commits.filter((commit) => /^fix(\([^)]*\))?!?:/i.test(commit.subject));
const maintenance = commits.filter(
  (commit) => !features.includes(commit) && !fixes.includes(commit),
);

const sections = ["## Highlights", ""];
const highlightSentences = [];

if (features.length > 0) {
  highlightSentences.push(
    `This release adds ${features
      .slice(0, 2)
      .map((commit) => cleanSubject(commit.subject))
      .join(" and ")}.`,
  );
}
if (fixes.length > 0) {
  highlightSentences.push(
    `It also fixes ${fixes
      .slice(0, 2)
      .map((commit) => cleanSubject(commit.subject))
      .join(" and ")}.`,
  );
}
sections.push(
  highlightSentences.join(" ") || "This release contains maintenance and reliability improvements.",
);

function appendSection(title, items) {
  if (items.length === 0) return;
  sections.push("", `## ${title}`, "");
  sections.push(...items.map((commit) => formatEntry(commit, repository)));
}

appendSection("New Features", features);
appendSection("Bug Fixes", fixes);
appendSection("Maintenance", maintenance);

if (previousTag && repository) {
  sections.push(
    "",
    `**Full Changelog**: [${previousTag}...${tag}](https://github.com/${repository}/compare/${previousTag}...${tag})`,
  );
}

writeFileSync(outputPath, `${sections.join("\n")}\n`);
