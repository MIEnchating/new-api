import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readTree(root, revision) {
  const tree = execFileSync(
    "git",
    ["rev-parse", "--verify", "--end-of-options", `${revision}^{tree}`],
    { cwd: root, encoding: "utf8", stdio: "pipe" },
  ).trim();
  const entries = execFileSync("git", ["ls-tree", "-r", "-z", tree], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return new Map(entries.split("\0").filter(Boolean).map((entry) => {
    const separator = entry.indexOf("\t");
    const [, , blob] = entry.slice(0, separator).split(" ");
    return [entry.slice(separator + 1), blob];
  }));
}

// Check the working tree by default, including unstaged removals and new files.
// A ref allows auditing a proposed merge without checking it out.
export function checkLocalChanges({ root, policy, ref }) {
  const before = readTree(root, policy.before_cleanup);
  const baseline = readTree(root, policy.local_baseline);
  const candidate = ref ? readTree(root, ref) : new Map();
  const allowed = new Set(policy.allowed_restorations);
  const paths = new Set([...before.keys(), ...baseline.keys()]
    .filter((name) => before.get(name) !== baseline.get(name)));
  for (const name of policy.required_paths) paths.add(name);
  if (!ref) {
    const algorithm = execFileSync("git", ["rev-parse", "--show-object-format"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
    for (const name of paths) {
      const filename = path.join(root, name);
      let stat;
      try {
        stat = lstatSync(filename);
      } catch (error) {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") continue;
        throw error;
      }
      if (!stat.isFile() && !stat.isSymbolicLink()) continue;
      const content = stat.isSymbolicLink()
        ? Buffer.from(readlinkSync(filename))
        : readFileSync(filename);
      candidate.set(name, createHash(algorithm)
        .update(`blob ${content.length}\0`).update(content).digest("hex"));
    }
  }

  const violations = [];
  let protectedChanges = 0;
  let retiredPaths = 0;
  for (const name of paths) {
    if (before.get(name) === baseline.get(name) || allowed.has(name)) continue;
    protectedChanges++;
    if (!baseline.has(name)) {
      retiredPaths++;
      if (candidate.has(name)) violations.push(`Restored intentionally deleted file: ${name}`);
    } else if (candidate.get(name) === before.get(name)) {
      violations.push(`Reverted local change to its pre-cleanup version: ${name}`);
    }
  }
  for (const name of policy.required_paths) {
    if (!candidate.has(name)) violations.push(`Missing required request-chain implementation or regression: ${name}`);
  }
  return { violations, protectedChanges, retiredPaths };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--ref")) {
      throw new Error("Usage: node .github/scripts/check-local-changes.mjs [--ref <revision>]");
    }
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
    const policy = JSON.parse(readFileSync(path.join(root, ".agents/upstream-sync-policy.json"), "utf8"));
    const result = checkLocalChanges({ root, policy, ref: args[1] });
    if (result.violations.length) {
      console.error(result.violations.join("\n"));
      throw new Error(`Local behavior guard rejected ${result.violations.length} changes. Preserve the local decisions; do not regenerate the policy to make a merge pass.`);
    }
    console.log(`Local behavior guard passed: ${result.protectedChanges} local changes, including ${result.retiredPaths} deleted paths.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
