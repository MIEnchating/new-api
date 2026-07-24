import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { validateReleaseTag } from "./validate-release-tag.mjs";

const args = process.argv.slice(2);
const tag = args.find((arg) => !arg.startsWith("--")) || process.env.GITHUB_REF_NAME;
const outputPath = args.filter((arg) => !arg.startsWith("--"))[1] || "release-notes.md";
const requireSource = args.includes("--require-source");

if (!tag) {
  throw new Error("Release tag is required");
}
validateReleaseTag(tag);

const requiredSections = [
  "版本概览",
  "新增功能",
  "功能改进",
  "问题修复",
  "移除与调整",
  "安全与兼容性",
  "部署说明",
];

function git(...gitArgs) {
  try {
    return execFileSync("git", gitArgs, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch (error) {
    if (error?.status === 0 && typeof error.stdout === "string") {
      return error.stdout.trim();
    }
    throw error;
  }
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
    .replace(
      /^(feat|fix|perf|refactor|build|ci|docs|test|style|chore|revert)(\([^)]*\))?!?:\s*/i,
      "",
    )
    .replace(/\s*\(#\d+\)\s*$/, "")
    .trim();
}

function formatEntry(commit, repository) {
  const title = cleanSubject(commit.subject);
  const shortHash = commit.hash.slice(0, 8);
  if (!repository) return `- ${title} (${shortHash})`;
  return `- ${title} ([${shortHash}](https://github.com/${repository}/commit/${commit.hash}))`;
}

function getCommits(range) {
  const rawLog = git("log", "--no-merges", "--pretty=format:%H%x09%s", range);
  if (!rawLog) return [];
  return rawLog.split("\n").map((line) => {
    const [hash, ...subjectParts] = line.split("\t");
    return { hash, subject: subjectParts.join("\t") };
  });
}

function generateFallbackNotes(commits, repository) {
  const groups = {
    新增功能: [],
    功能改进: [],
    问题修复: [],
    移除与调整: [],
    文档与测试: [],
    构建与维护: [],
  };

  for (const commit of commits) {
    const type = commit.subject.match(/^([a-z]+)(\([^)]*\))?!?:/i)?.[1]?.toLowerCase();
    if (type === "feat") groups["新增功能"].push(commit);
    else if (type === "fix") groups["问题修复"].push(commit);
    else if (["perf", "refactor", "style"].includes(type)) groups["功能改进"].push(commit);
    else if (type === "revert" || /\b(remove|delete)\b/i.test(commit.subject))
      groups["移除与调整"].push(commit);
    else if (["docs", "test"].includes(type)) groups["文档与测试"].push(commit);
    else groups["构建与维护"].push(commit);
  }

  const lines = [
    "## 版本概览",
    "",
    `本版本包含 ${commits.length} 个非合并提交。以下内容根据规范化提交记录自动生成。`,
  ];
  for (const [title, items] of Object.entries(groups)) {
    lines.push("", `## ${title}`, "");
    if (items.length === 0) lines.push("- 无");
    else lines.push(...items.map((commit) => formatEntry(commit, repository)));
  }
  lines.push(
    "",
    "## 安全与兼容性",
    "",
    "- 请在升级前检查配置项、环境变量和接口兼容性。",
    "",
    "## 部署说明",
    "",
    "- 建议先备份数据库和现有配置，再执行升级。",
  );
  return lines.join("\n");
}

function validateSource(content, sourcePath) {
  const missing = requiredSections.filter(
    (section) => !new RegExp(`^##\\s+${section}\\s*$`, "m").test(content),
  );
  if (missing.length > 0) {
    throw new Error(`${sourcePath} is missing required sections: ${missing.join(", ")}`);
  }
  if (/<!--\s*请填写|TODO|待补充/i.test(content)) {
    throw new Error(`${sourcePath} still contains unfinished placeholders`);
  }
}

function parseChangedFiles(range) {
  const raw = git("diff", "--name-status", "--find-renames", range);
  const groups = {
    added: [],
    modified: [],
    deleted: [],
    renamed: [],
    other: [],
  };
  if (!raw) return groups;

  for (const line of raw.split("\n")) {
    const [status, ...paths] = line.split("\t");
    const code = status[0];
    if (code === "A") groups.added.push(paths[0]);
    else if (code === "M") groups.modified.push(paths[0]);
    else if (code === "D") groups.deleted.push(paths[0]);
    else if (code === "R") groups.renamed.push(`${paths[0]} -> ${paths[1]}`);
    else groups.other.push(paths.join(" -> "));
  }
  return groups;
}

function getLineStats(range) {
  const raw = git("diff", "--numstat", range);
  let additions = 0;
  let deletions = 0;
  if (raw) {
    for (const line of raw.split("\n")) {
      const [added, deleted] = line.split("\t");
      if (/^\d+$/.test(added)) additions += Number(added);
      if (/^\d+$/.test(deleted)) deletions += Number(deleted);
    }
  }
  return { additions, deletions };
}

function escapePath(path) {
  return path.replaceAll("`", "\\`");
}

function appendFileGroup(lines, title, files) {
  lines.push("", `### ${title} (${files.length})`, "");
  if (files.length === 0) {
    lines.push("- 无");
    return;
  }
  lines.push(...files.map((file) => `- \`${escapePath(file)}\``));
}

const previousTag = getPreviousTag();
const range = previousTag ? `${previousTag}..${tag}` : tag;
const repository = process.env.GITHUB_REPOSITORY || "";
const commits = getCommits(range);
const sourcePath = join(".github", "release-notes", `${tag}.md`);

let body;
if (existsSync(sourcePath)) {
  body = readFileSync(sourcePath, "utf8").trim();
  validateSource(body, sourcePath);
} else {
  if (requireSource) {
    throw new Error(
      `Missing ${sourcePath}. Copy .github/release-notes/TEMPLATE.md, complete every section, commit it, and create the tag again.`,
    );
  }
  body = generateFallbackNotes(commits, repository);
}

const changedFiles = parseChangedFiles(range);
const lineStats = getLineStats(range);
const totalFiles = Object.values(changedFiles).reduce((total, files) => total + files.length, 0);
const technical = [
  "",
  "## 发布产物",
  "",
  "- Linux x86_64",
  "- Linux ARM64",
  "- macOS x86_64",
  "- Windows x86_64",
  "- GitHub 自动生成的源码压缩包",
  "",
  "## 代码变更统计",
  "",
  `- 非合并提交：${commits.length}`,
  `- 变更文件：${totalFiles}`,
  `- 新增文件：${changedFiles.added.length}`,
  `- 修改文件：${changedFiles.modified.length}`,
  `- 删除文件：${changedFiles.deleted.length}`,
  `- 重命名文件：${changedFiles.renamed.length}`,
  `- 代码行：+${lineStats.additions} / -${lineStats.deletions}`,
  "",
  "<details>",
  "<summary>查看完整文件变更列表</summary>",
];

appendFileGroup(technical, "新增文件", changedFiles.added);
appendFileGroup(technical, "修改文件", changedFiles.modified);
appendFileGroup(technical, "删除文件", changedFiles.deleted);
appendFileGroup(technical, "重命名文件", changedFiles.renamed);
appendFileGroup(technical, "其他变更", changedFiles.other);
technical.push("", "</details>");

if (previousTag && repository) {
  technical.push(
    "",
    `**完整变更对比**：[${previousTag}...${tag}](https://github.com/${repository}/compare/${previousTag}...${tag})`,
  );
}

writeFileSync(outputPath, `${body}\n${technical.join("\n")}\n`);
