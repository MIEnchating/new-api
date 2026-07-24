import { execFileSync } from "node:child_process";
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
  console.log(`Validated release tag: ${tag}`);
}
