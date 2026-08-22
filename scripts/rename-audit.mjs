#!/usr/bin/env node
// Guards the bb -> Patcher rename (docs/architecture/rename-to-patcher.md).
//
//   node scripts/rename-audit.mjs            # fail on anything unjustified
//   node scripts/rename-audit.mjs --list     # also print what the rules allowed
//
// Two scans over every tracked text file:
//
// FORWARD — any word containing `bb` in any case. Deliberately blunt. A clever
// pattern that skips `bubble` also skips `bb-something-new`, and the whole
// point of a gate is to catch the token nobody thought of. The noise that
// creates is answered by ALLOW below, where every entry carries its reason.
//
// REVERSE — `patcher` with a lowercase letter or digit welded to its left,
// which is what a careless s/bb/patcher/ leaves behind: `clobber` becomes
// `clopatcherer`, `abbrev` becomes `apatcherrev`, a hex digest grows a word in
// its middle. Only the left side is checked: `patcher` followed by lowercase is
// ordinary (`patcherdh_`, the anchor `#patcherlog`), while nothing legitimately
// runs into it from the left except `dispatcher`, and the tree has ~190 of
// those, so they are matched and dropped rather than left to drown the signal.
//
// Adding an ALLOW entry is a claim that a `bb` is correct and will stay
// correct. Write the reason for a reader who was not here.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const listMode = process.argv.includes("--list");

const SKIP_PATHS = [
  // The plan itself names every old token on purpose.
  "docs/architecture/rename-to-patcher.md",
  // This file's own rules quote the tokens they match.
  "scripts/rename-audit.mjs",
];

const BINARY_EXTENSIONS =
  /\.(png|jpg|jpeg|gif|webp|avif|ico|icns|woff2?|ttf|otf|eot|zip|gz|tgz|pdf|mp4|mov|webm|wasm|node|db|sqlite)$/iu;

// --- shared shapes ---------------------------------------------------------
// A digest, a UUID, or one of the opaque provider ids that litter recorded
// fixtures. None of these is a name anyone chose, so `bb` inside one is noise.
const HEX_OR_UUID = /^[0-9a-f]{6,}$|^[0-9a-f-]{20,}$/iu;
const OPAQUE_ID =
  /^(?:toolu|call|req|msg|turn|ws|thr|env|proj|src|run|sha256|sha512)[_-][A-Za-z0-9_-]{6,}$/u;
// A long alphanumeric run that also carries a shouted uppercase run or several
// digits is a base64 or minified fragment, not an identifier someone typed.
// Length alone is not enough: `BbSomethingLongEnough` is 21 characters and
// would have walked straight through.
const isBase64ish = (word) =>
  word.length >= 16 &&
  /^[A-Za-z0-9+/=]+$/u.test(word) &&
  (/[A-Z]{4,}/u.test(word) || (word.match(/\d/gu) ?? []).length >= 2);
// aaa / bbb / BBBB / bbb2222 — the second item in a list of placeholders. Three
// repeats, not two: at two this matches a bare `bb` and quietly excuses the
// whole thing the audit exists to find.
const REPEATED_PLACEHOLDER = /^([A-Za-z])\1{2,}[0-9]*$/u;
// English words and library names that legitimately carry a double b. Two
// copies on purpose: `.test()` on a /g/ regex advances lastIndex, so the rule
// below must not share one object between its match and its strip.
const ENGLISH_DOUBLE_B_SOURCE =
  "bubble|clobber|stubbed|stubborn|grabb|abbrev|tabbab|tabbed|tabbing|rubber|globby|robbie|dabble|nibble|scribble|wobble";
const ENGLISH_DOUBLE_B = new RegExp(ENGLISH_DOUBLE_B_SOURCE, "iu");
const ENGLISH_DOUBLE_B_ALL = new RegExp(ENGLISH_DOUBLE_B_SOURCE, "giu");

/**
 * Each rule may constrain the matched word, the path it sits in, and the line
 * around it. A finding is justified when one rule matches every field it
 * declares.
 */
const ALLOW = [
  // --- The values that used to be frozen -----------------------------------
  // All six were unfrozen and renamed; three of the justifications turned out
  // to be wrong (the plan's Frozen table records which). What is left is the
  // old name appearing in a comment that explains the new one, and each of
  // those is pinned by a test naming the value it now carries.
  {
    why: "a comment recording the partition rename's actual cost: userData moved with productName, so the old cookies were unreachable either way",
    word: /^bb$/u,
    line: /moved `productName` from "bb"/u,
  },
  {
    why: "comments on OpenAI's originator field, where the inherited value is the one fact that argues the new one is accepted",
    word: /^bb$/u,
    line: /inherited `bb` worked here at all|go back to the inherited `bb`/u,
  },
  {
    why: "the audit's own worked example of what it cannot see: a `bb` that became a `patcher`",
    word: /^bb$/u,
    line: /a `bb` that became a/u,
  },
  {
    why: "the two preloads name the global they no longer expose, which is the whole reason one name is enough",
    word: /^(?:bb|bbDesktop)$/u,
    line: /never shipped a build that reads `bbDesktop`|ever exposed page scripts under `bb`/u,
  },
  {
    why: "the assertion that an out-of-date daemon's subprotocol is now refused; the old value is the case worth stating",
    word: /^bb-host-daemon$/u,
    line: /hasHostDaemonWebSocketProtocol\("bb-host-daemon/u,
  },

  // --- Physical database names kept on purpose -----------------------------
  {
    why: "drizzle column; renaming means a migration plus regenerated snapshots for zero visible gain",
    word: /^rollback_bb_version$/u,
  },
  {
    // `bb_connect` is a `system_experiments` column, dropped back in
    // 0070_swift_rattler.sql — the name survives only in that migration.
    // `_bb_connect_machine_id_pending` is live: migrate.ts stages the
    // `connect_machine_id` rename through it, so it is read on every startup
    // that has not yet applied 0065.
    why: "a dropped drizzle column named in its own migration, and the staging column migrate.ts renames through",
    word: /^(?:bb_connect|_bb_connect_machine_id_pending)$/u,
  },
  {
    why: "the tasks plugin's own column, already mapped to linkedPatcherProjectId above store.ts",
    word: /^linked_bb_project_id$/u,
  },

  // --- History: things that happened under the old name --------------------
  {
    why: "the migration map names what this fork migrated from; patcher-migration.md would misdescribe it",
    word: /^bb-migration$/u,
  },
  {
    why: "a dated record of a manual QA pass that really ran against bb",
    path: /^qa\/manual-pass-log\.md$/u,
  },
  {
    why: "issue keys from bb's tracker, cited in comments; renumbering them into a tracker with no such issues would make them lie",
    word: /^BB-\d+$/u,
  },
  {
    why: "a task-branch slug derived from a BB- issue key",
    word: /^bb-\d+$/u,
  },
  {
    why: "a drizzle migration filename; the words are generated, the file is immutable",
    word: /^0063_broken_robbie_robertson$/u,
  },
  {
    why: "recorded agent transcripts captured on an upstream machine, replayed verbatim as fixtures",
    word: /bb-fixture-capture/u,
  },
  {
    why: "the migration map records what this fork inherited, including names that only ever existed under bb",
    path: /^docs\/architecture\/bb-migration\.md$/u,
  },
  {
    // Both tokens on that line describe what the *pre-rename* daemon injects,
    // so both have to keep the old name or the sentence inverts and claims the
    // old daemon already spoke the new contract.
    why: "a comment naming the old env prefix and shim on purpose, so the protocol bump's reason reads",
    word: /^(?:BB_|bb)$/u,
    line: /injects `BB_\*`/u,
  },
  {
    why: "a contributor's GitHub handle",
    word: /^ryanbbrown$/u,
  },
  {
    why: "an unreferenced scaffold digest, dead before this rename and left alone rather than quietly deleted",
    path: /^apps\/server\/test\/public\/app-scaffold-template\.digest\.json$/u,
  },

  // --- The fork is stated on purpose ---------------------------------------
  {
    why: "the fork attribution and the comments explaining a frozen name or a removed link",
    word: /^(?:bb|get-bb)$/u,
    line: /fork of \[bb\]|a bb install|bb's server|belonged to bb|github\.com\/get-bb/u,
  },

  // --- English, libraries, and camelCase seams -----------------------------
  {
    // Matching the substring alone fails open: `bb-tabbed-panel` contains
    // `tabbed`, and `-` is a word character here, so a genuine leftover rides
    // in on an English neighbour. Strip every English hit and require that no
    // `bb` survives, so the rule excuses the word only when the English word
    // is the *reason* the word matched.
    why: "English words and library names that happen to contain a double b",
    test: (word) => !/[Bb][Bb]/u.test(word.replace(ENGLISH_DOUBLE_B_ALL, "")),
    word: ENGLISH_DOUBLE_B,
  },
  {
    why: "a camelCase seam: a word ending in b followed by one starting with B",
    word: /^[A-Za-z0-9_]*(?:[Tt]ab|[Ww]eb|[Ss]ub|[Ll]ab|[Cc]ab|[Nn]ub|[Rr]ib|[Tt]humb|[Cc]rumb)B[A-Za-z0-9_]*$/u,
  },
  {
    why: "BBEdit, an editor Patcher can open a workspace in",
    word: /^bbedit/iu,
  },
  {
    why: "a regex or unicode escape whose backslash-b is followed by a b-initial word",
    line: /\\(?:b|u[0-9A-Fa-f]{4})[Bb]/u,
  },

  // --- Placeholders and opaque values --------------------------------------
  {
    why: "the second item in an aaa/bbb placeholder series",
    test: (word) => REPEATED_PLACEHOLDER.test(word),
  },
  {
    why: "a plugin id from an aaa/bbb placeholder series",
    word: /^patcher-plugin-b+$/u,
  },
  {
    why: "an authored CSS class in a build fixture, named after a hash prefix",
    word: /^bb71-authored-decoration$/u,
  },
  {
    why: "a hex digest, UUID, opaque provider id, or base64 fragment",
    test: (word) =>
      HEX_OR_UUID.test(word) || OPAQUE_ID.test(word) || isBase64ish(word),
  },
  {
    why: "a piece of an npm integrity digest; bun.lock hashes are base64 and split into words wherever a + or / falls",
    path: /^bun\.lock$/u,
    line: /"sha(?:1|256|512)-/u,
    test: (word) =>
      /^[A-Za-z0-9]{6,}$/u.test(word) &&
      /[A-Z]/u.test(word) &&
      /[a-z]/u.test(word),
  },
];

const REVERSE_ALLOW = [
  {
    why: "dispatcher and CommandDispatchError; ~190 of them and none is rename damage",
    word: /dispatch/iu,
  },
];

// ---------------------------------------------------------------------------

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  })
    .split("\0")
    .filter(
      (path) =>
        path.length > 0 &&
        !SKIP_PATHS.includes(path) &&
        !BINARY_EXTENSIONS.test(path),
    );
}

function justification(rules, word, path, line) {
  for (const rule of rules) {
    if (rule.word !== undefined && !rule.word.test(word)) continue;
    if (rule.path !== undefined && !rule.path.test(path)) continue;
    if (rule.line !== undefined && !rule.line.test(line)) continue;
    if (rule.test !== undefined && !rule.test(word)) continue;
    return rule.why;
  }
  return null;
}

const FORWARD_WORD = /[A-Za-z0-9_-]*[Bb][Bb][A-Za-z0-9_-]*/gu;
const REVERSE_WORD = /[A-Za-z0-9_-]*patcher[A-Za-z0-9_-]*/gu;
const REVERSE_FUSED = /(?<=[a-z0-9])patcher/u;

const findings = [];
const allowed = new Map();

function record(rules, direction, word, path, lineNumber, line) {
  const why = justification(rules, word, path, line);
  if (why === null) {
    findings.push({ direction, word, path, lineNumber, line: line.trim() });
    return;
  }
  const seen = allowed.get(why) ?? { count: 0, words: new Set() };
  seen.count += 1;
  if (seen.words.size < 8) seen.words.add(word);
  allowed.set(why, seen);
}

for (const path of trackedFiles()) {
  let raw;
  try {
    raw = readFileSync(path);
  } catch {
    continue;
  }
  if (raw.includes(0)) continue; // binary by content, whatever the extension
  const lines = raw.toString("utf8").split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.length > 4000) continue; // a minified or base64 line, not source
    // Both patterns start with `[A-Za-z0-9_-]*`, so matchAll backtracks from
    // every offset in every line. The overwhelming majority of lines hold
    // neither token; skipping those first is ~10x on the whole scan and
    // cannot change the result, because a match requires one of these
    // substrings to be present.
    if (
      !line.includes("bb") &&
      !line.includes("bB") &&
      !line.includes("Bb") &&
      !line.includes("BB") &&
      !line.includes("patcher")
    ) {
      continue;
    }
    for (const match of line.matchAll(FORWARD_WORD)) {
      record(ALLOW, "bb", match[0], path, index + 1, line);
    }
    for (const match of line.matchAll(REVERSE_WORD)) {
      if (!REVERSE_FUSED.test(match[0])) continue;
      record(REVERSE_ALLOW, "patcher", match[0], path, index + 1, line);
    }
  }
}

if (listMode) {
  console.log("Justified:");
  const byCount = [...allowed].sort((a, b) => b[1].count - a[1].count);
  for (const [why, seen] of byCount) {
    console.log(`  ${String(seen.count).padStart(4)}  ${why}`);
    console.log(`        e.g. ${[...seen.words].join(", ")}`);
  }
  console.log("");
}

if (findings.length === 0) {
  const total = [...allowed.values()].reduce(
    (sum, seen) => sum + seen.count,
    0,
  );
  console.log(`rename audit: clean (${total} occurrences justified by rule)`);
  process.exit(0);
}

console.error(
  `rename audit: ${findings.length} occurrence${findings.length === 1 ? "" : "s"} with no justification.\n`,
);
for (const finding of findings.slice(0, 60)) {
  console.error(
    `  ${finding.path}:${finding.lineNumber}  ${finding.direction === "bb" ? "residual" : "damaged"} "${finding.word}"`,
  );
  console.error(`      ${finding.line.slice(0, 120)}`);
}
if (findings.length > 60) {
  console.error(`  ... and ${findings.length - 60} more`);
}
console.error(
  "\nEither rename it, or add a rule to ALLOW in scripts/rename-audit.mjs with the reason it stays.",
);
process.exit(1);
