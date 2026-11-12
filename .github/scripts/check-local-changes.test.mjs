import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { checkLocalChanges } from "./check-local-changes.mjs";

test("rejects restored deletions and old behavior while allowing request chains and new upstream changes", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "local-merge-guard-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const commit = (message) => {
    git("add", "-A");
    git("-c", "user.name=Merge Guard Test", "-c", "user.email=guard@example.invalid",
      "-c", "commit.gpgsign=false", "commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q");
  writeFileSync(path.join(root, "execution.txt"), "old execution feature");
  writeFileSync(path.join(root, "sorting.txt"), "old sorting");
  writeFileSync(path.join(root, "request-chain.txt"), "request chain");
  const before = commit("before cleanup");
  rmSync(path.join(root, "execution.txt"));
  rmSync(path.join(root, "request-chain.txt"));
  writeFileSync(path.join(root, "sorting.txt"), "local sorting");
  const baseline = commit("local cleanup");
  const policy = {
    before_cleanup: before,
    local_baseline: baseline,
    allowed_restorations: ["request-chain.txt"],
    required_paths: ["request-chain.txt"],
  };
  writeFileSync(path.join(root, "request-chain.txt"), "request chain");
  assert.deepEqual(checkLocalChanges({ root, policy }).violations, []);

  writeFileSync(path.join(root, "execution.txt"), "rewritten execution feature");
  assert.match(checkLocalChanges({ root, policy }).violations.join("\n"), /Restored intentionally deleted file: execution.txt/);
  rmSync(path.join(root, "execution.txt"));
  writeFileSync(path.join(root, "sorting.txt"), "old sorting");
  assert.match(checkLocalChanges({ root, policy }).violations.join("\n"), /Reverted local change.*sorting.txt/);
  const badMerge = commit("accidental restoration");

  writeFileSync(path.join(root, "sorting.txt"), "local sorting with upstream fix");
  assert.deepEqual(checkLocalChanges({ root, policy }).violations, []);
  assert.match(checkLocalChanges({ root, policy, ref: badMerge }).violations.join("\n"), /Reverted local change/);
  rmSync(path.join(root, "request-chain.txt"));
  assert.match(checkLocalChanges({ root, policy }).violations.join("\n"), /Missing required request-chain/);
  assert.throws(() => checkLocalChanges({ root, policy, ref: "missing-candidate" }));
});
