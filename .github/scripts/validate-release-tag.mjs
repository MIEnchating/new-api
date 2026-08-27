import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const RELEASE_TAG_PATTERN =
  /^v(\d{4})\.(\d{2})\.(\d{2})(?:-([2-9]|[1-9]\d+))?$/;

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
    throw new Error(
      `Release tag ${baseTag}-${revision} requires previous tag ${previousTag}`,
    );
  }
}

const requiredReleaseSections = [
  "版本概览",
  "新增功能",
  "功能改进",
  "问题修复",
  "移除与调整",
  "安全与兼容性",
  "部署说明",
];

function requireReleaseNotes(tag) {
  const sourcePath = `.github/release-notes/${tag}.md`;
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing ${sourcePath}. Complete the release notes before creating the tag.`);
  }
  const content = readFileSync(sourcePath, "utf8");
  const missing = requiredReleaseSections.filter(
    (section) => !new RegExp(`^##\\s+${section}\\s*$`, "m").test(content),
  );
  if (missing.length > 0) {
    throw new Error(`${sourcePath} is missing required sections: ${missing.join(", ")}`);
  }
  if (/<!--\s*请填写|TODO|待补充/i.test(content)) {
    throw new Error(`${sourcePath} still contains unfinished placeholders`);
  }
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
