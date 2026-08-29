import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const RELEASE_TAG_PATTERN = /^v(\d{4})\.(\d{2})\.(\d{2})(?:-([2-9]|[1-9]\d+))?$/;

function requireValidCalendarDate(year, month, day, tag) {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Release tag contains an invalid calendar date: ${tag}`);
  }
}

function requirePreviousTag(baseTag, revision) {
  if (revision === undefined) return;
  const previousTag = revision === 2 ? baseTag : `${baseTag}-${revision - 1}`;
  try {
    execFileSync("git", ["show-ref", "--verify", "--quiet", `refs/tags/${previousTag}`]);
  } catch {
    throw new Error(`Release tag ${baseTag}-${revision} requires previous tag ${previousTag}`);
  }
}

const requiredReleaseSections = ["版本概览", "新增功能", "功能改进", "问题修复", "移除与调整"];

const forbiddenReleaseContent = [
  { pattern: /^#{1,6}\s+安全与兼容性\s*$/m, label: "安全与兼容性" },
  { pattern: /^#{1,6}\s+部署说明\s*$/m, label: "部署说明" },
  { pattern: /^#{1,6}\s+发布产物\s*$/m, label: "发布产物" },
  { pattern: /^#{1,6}\s+代码变更统计\s*$/m, label: "代码变更统计" },
  { pattern: /查看完整文件变更列表/, label: "完整文件变更列表" },
  { pattern: /完整变更对比/, label: "完整变更对比" },
  {
    pattern: /(?:https:\/\/github\.com\/[^\s)]+)?\/compare\/[^\s)]+/i,
    label: "GitHub compare 链接",
  },
];

export function validateReleaseNotesContent(content, sourcePath = "release notes") {
  const headingMatches = [...content.matchAll(/^##\s+(.+?)\s*$/gm)];
  const headings = headingMatches.map((match) => match[1]);
  const missing = requiredReleaseSections.filter((section) => !headings.includes(section));
  if (missing.length > 0) {
    throw new Error(`${sourcePath} is missing required sections: ${missing.join(", ")}`);
  }
  const forbidden = forbiddenReleaseContent
    .filter(({ pattern }) => pattern.test(content))
    .map(({ label }) => label);
  if (forbidden.length > 0) {
    throw new Error(`${sourcePath} contains forbidden release content: ${forbidden.join(", ")}`);
  }
  if (
    headings.length !== requiredReleaseSections.length ||
    headings.some((heading, index) => heading !== requiredReleaseSections[index])
  ) {
    throw new Error(
      `${sourcePath} must contain exactly these sections in order: ${requiredReleaseSections.join(", ")}`,
    );
  }
  if (/<!--\s*请填写|TODO|待补充/i.test(content)) {
    throw new Error(`${sourcePath} still contains unfinished placeholders`);
  }
  const empty = headingMatches
    .filter((match, index) => {
      const bodyStart = match.index + match[0].length;
      const bodyEnd = headingMatches[index + 1]?.index ?? content.length;
      const body = content
        .slice(bodyStart, bodyEnd)
        .replace(/<!--[\s\S]*?-->/g, "")
        .trim();
      return body.length === 0;
    })
    .map((match) => match[1]);
  if (empty.length > 0) {
    throw new Error(
      `${sourcePath} has empty required sections: ${empty.join(", ")}. Use - 无 when a section has no entries.`,
    );
  }
}

function requireReleaseNotes(tag) {
  const sourcePath = `.github/release-notes/${tag}.md`;
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing ${sourcePath}. Complete the release notes before creating the tag.`);
  }
  const content = readFileSync(sourcePath, "utf8");
  validateReleaseNotesContent(content, sourcePath);
}

export function validateReleaseTag(tag, options = {}) {
  const match = RELEASE_TAG_PATTERN.exec(tag);
  if (!match) {
    throw new Error(
      `Unsupported release tag: ${tag}. Use vYYYY.MM.DD for the first release, then vYYYY.MM.DD-2, -3, and so on. The -1 suffix is forbidden.`,
    );
  }

  const [, yearText, monthText, dayText, revisionText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const revision = revisionText === undefined ? undefined : Number(revisionText);
  requireValidCalendarDate(year, month, day, tag);

  const baseTag = `v${yearText}.${monthText}.${dayText}`;
  if (options.checkSequence !== false) {
    requirePreviousTag(baseTag, revision);
  }
  return { baseTag, revision };
}

const entryPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryPath) {
  const tag = process.argv[2];
  if (!tag) {
    throw new Error("Release tag is required");
  }
  validateReleaseTag(tag);
  requireReleaseNotes(tag);
  console.log(`Validated release tag: ${tag}`);
}
