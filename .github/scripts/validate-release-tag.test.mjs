import assert from "node:assert/strict";
import test from "node:test";

import { validateReleaseNotesContent, validateReleaseTag } from "./validate-release-tag.mjs";

const validReleaseNotes = `## 版本概览

- 本版本改善用户体验。

## 新增功能

- 无

## 功能改进

- 优化现有功能。

## 问题修复

- 修复已知问题。

## 移除与调整

- 无
`;

test("accepts the first daily release without a suffix", () => {
  assert.deepEqual(validateReleaseTag("v2026.07.24", { checkSequence: false }), {
    baseTag: "v2026.07.24",
    revision: undefined,
  });
});

test("accepts later daily releases starting at two", () => {
  assert.equal(validateReleaseTag("v2026.07.24-2", { checkSequence: false }).revision, 2);
  assert.equal(validateReleaseTag("v2026.07.24-12", { checkSequence: false }).revision, 12);
});

test("rejects the redundant first-release suffix", () => {
  assert.throws(
    () => validateReleaseTag("v2026.07.24-1", { checkSequence: false }),
    /-1 suffix is forbidden/,
  );
});

test("rejects invalid or non-padded dates", () => {
  assert.throws(
    () => validateReleaseTag("v2026.02.30", { checkSequence: false }),
    /invalid calendar date/,
  );
  assert.throws(
    () => validateReleaseTag("v2026.7.24", { checkSequence: false }),
    /Unsupported release tag/,
  );
});

test("accepts release notes with exactly the five user-facing sections", () => {
  assert.doesNotThrow(() => validateReleaseNotesContent(validReleaseNotes));
});

test("rejects missing, extra, duplicated, or reordered sections", () => {
  assert.throws(
    () => validateReleaseNotesContent(validReleaseNotes.replace("## 问题修复\n", "")),
    /missing required sections: 问题修复/,
  );
  assert.throws(
    () => validateReleaseNotesContent(`${validReleaseNotes}\n## 已知问题\n\n- 无\n`),
    /must contain exactly these sections in order/,
  );
  assert.throws(
    () => validateReleaseNotesContent(`${validReleaseNotes}\n## 新增功能\n\n- 无\n`),
    /must contain exactly these sections in order/,
  );
  assert.throws(
    () =>
      validateReleaseNotesContent(
        validReleaseNotes
          .replace("## 新增功能", "## TEMP")
          .replace("## 功能改进", "## 新增功能")
          .replace("## TEMP", "## 功能改进"),
      ),
    /must contain exactly these sections in order/,
  );
});

test("rejects legacy technical release content and compare links", () => {
  const forbiddenSnippets = [
    "\n## 安全与兼容性\n\n- 无\n",
    "\n## 部署说明\n\n- 无\n",
    "\n## 发布产物\n\n- Linux\n",
    "\n## 代码变更统计\n\n- 变更文件：1\n",
    "\n<summary>查看完整文件变更列表</summary>\n",
    "\n**完整变更对比**：无\n",
    "\nhttps://github.com/example/new-api/compare/v1...v2\n",
    "\n[查看变更](/compare/v1...v2)\n",
  ];

  for (const snippet of forbiddenSnippets) {
    assert.throws(
      () => validateReleaseNotesContent(`${validReleaseNotes}${snippet}`),
      /forbidden release content|must contain exactly these sections in order/,
    );
  }
});

test("rejects unfinished release note placeholders", () => {
  assert.throws(
    () => validateReleaseNotesContent(`${validReleaseNotes}\n<!-- 请填写内容 -->\n`),
    /unfinished placeholders/,
  );
});

test("rejects empty sections and requires an explicit no-content entry", () => {
  assert.throws(
    () => validateReleaseNotesContent(validReleaseNotes.replace("- 修复已知问题。", "")),
    /empty required sections: 问题修复.*Use - 无/,
  );
});
