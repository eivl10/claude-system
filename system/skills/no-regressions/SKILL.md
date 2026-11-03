---
name: no-regressions
description: Prevents re-introducing previously-fixed bugs and re-litigating settled decisions. Trigger: editing a file listed in FIXES.md, confirming a fix works, making a non-trivial architectural/approach decision, the 3rd+ change in a session, or the user says a bug "came back" / "again" / "regression" / "вернулся" / "опять".
---

# No Regressions

`FIXES.md` is an experience log, not just a bug tracker: bugs AND non-obvious decisions, so the next session doesn't rediscover either from scratch. Cheapest check first. Escalate only if needed.

## Before editing a file

1. Locate the symbol: `search_symbols` → `get_symbol_source`. Never read the whole file.
2. `get_symbol_provenance` — one call returns every commit touching the symbol, classified (creation / **bugfix** / refactor / revert) plus a narrative of *why*. Replaces `git log` + `git log -p`.
3. No bugfix commits → edit normally. Stop here.
4. Bugfix commits found, but the narrative doesn't say why the obvious fix was rejected → jdocmunch `search_sections` on `FIXES.md` for the function/file name.

Если в `FIXES.md` нашлось больше 5 записей — `jev_rerank` их против планируемой правки, читать только верхние.

Repo not indexed: fall back to `git log --oneline -- <file>`, then `git log -p -3` on the fix commits only.

**Provenance sees committed history only.** Run `git status --short` first. If the file is listed as modified or untracked, every fix made since the last commit is invisible to step 2 — go straight to `FIXES.md` and do not treat "no bugfix commits" as "no prior fixes".

## Before a non-trivial decision (not just before editing)

Choosing between 2+ viable approaches (library, pattern, architecture, UI convention)? Same check as above, minus the symbol step: `search_sections` on `FIXES.md` for the topic/area *before* committing to an approach — not just before touching a specific file. Someone may have already tried the obvious option and rejected it for a reason that isn't visible in the current code.

## After fixing any bug — or making a non-obvious decision

Append to `FIXES.md` immediately — not at end of task. Create the file if missing.

```
## <file>:<function/area>
Что: <one line — bug that broke, OR decision that was made>
Логика: <1-2 lines — why this way; what was rejected and why>
Итог: <one line — what changed / what was implemented>
```

Max 6 lines per entry. The file is searched by section, never read whole.

Log a decision (not a bug) only when it had a real fork — 2+ options actually considered, and the choice isn't obvious from the spec. Don't log routine features or refactors that follow directly from what was asked.

Add a regression test in the same commit **only if** the project has a working test runner and the fix is behaviorally testable. If `npm test` is a stub (`echo "no test specified"`), skip it — do not scaffold a harness mid-bugfix.

## Cross-project search

If a similar-sounding project has its own `FIXES.md` indexed in jdocmunch, both files may be in the `experience-log` repo group — search it with `repo_group="experience-log"` instead of a single repo to check whether the same problem was already solved elsewhere before treating it as novel.

## Stale index

jcodemunch serves cached content. When the index predates the last edit, `search_text` and `search_symbols` report code that no longer exists on disk — and a "the fix is missing" or "the guard is still there" conclusion drawn from them is false in the most dangerous direction.

`register_edit` clears caches but does not reliably re-read file contents, and `index_folder` can refuse with an identity conflict. Neither reporting success proves the index is fresh.

So: before concluding that a fix is absent or a guard is present, **read the actual file** at that line range. Verify on disk, then act. `resolve_repo` reports `indexed_at` — if it predates today's edits, treat every search result as a lead, not evidence.

## Session/context boundaries

After `/compact` or in a new session, if the target file appears in `FIXES.md`, always run step 4 before editing. Compaction drops the *reasoning* behind a fix first — the code survives, the "why" does not.

## Do not

- Don't read all of `FIXES.md` — search it by name.
- Don't log routine features/refactors with no real fork in the decision. Bugs — always. Decisions — only when non-obvious.
- Don't duplicate git: if provenance fully explains the fix, skip the `FIXES.md` entry.
