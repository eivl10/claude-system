---
name: jcodemunch
description: Use jCodemunch MCP tools for symbol-level code navigation instead of raw Read/Grep/Glob/Bash. Loads on demand; complements the always-on policy block.
---

# jCodemunch Code Exploration Skill

Load this skill when navigating code, investigating dependencies, planning refactors, or assembling task context. The jcodemunch MCP server provides symbol-aware retrieval and graph relationships that regex and full-file reads cannot reproduce.

## When to load this skill

- Opening a session in an unfamiliar repo
- Tracing what depends on a symbol before changing it
- Finding similar implementations to consolidate
- Producing a context capsule for a multi-step task
- Auditing dead code, churn hotspots, or architectural health

## When NOT to load this skill

- You already know the exact file and line — just `Read` it (the   policy block notes the `Read`-before-`Edit` exception).
- The task is purely conversational with no code context.
- The repo is unindexed and you don't intend to index it.

## Tool taxonomy

The policy block already enumerates the canonical decision tree. What follows is procedural advice for *how* to use those tools, not a duplicate listing.

### Opening move

Before any code exploration:

1. `resolve_repo({"path": "."})` — confirms the repo is indexed and queryable. If `indexed: false`, run `index_folder`.
2. `plan_turn({"repo": "...", "query": "...", "model": "<your-model-id>"})` — gets a confidence verdict + recommended files. Obey the confidence:
   - `high` → go directly to the recommended symbols.
   - `medium` → explore the recommended files, cap supplementary reads.
   - `low` → the capability likely doesn't exist; report the gap, do      not keep searching hoping it appears.

### Reading code

Never `Read` a full file as a first move. The chain is:

- `get_file_outline(file_path)` → see the symbol layout first.
- `get_symbol_source(symbol_id)` → fetch just the function body you need.
- `get_context_bundle(symbol_id)` → if you also need its imports/types.
- `get_file_content(file_path, start_line, end_line)` → last resort,   only for ranges that aren't symbol-shaped.

### Relationships

Each does something distinct; pick by question:

- "What imports this file?" → `find_importers`
- "Where is this identifier used?" → `find_references`
- "Is this identifier used anywhere?" → `check_references` (fast yes/no)
- "What breaks if I change X?" → `get_blast_radius`
- "Who calls this / what does this call?" → `get_call_hierarchy`
- "Is this safe to rename?" → `check_rename_safe`
- "Is this safe to delete?" → `check_delete_safe` (8 verdict tiers)
- "What's similar to this in the codebase?" → `find_similar_symbols`

### Task orchestration

When a task spans multiple tools, prefer the orchestrator:

- `assemble_task_context({"task": "natural-language task"})`   auto-classifies into one of six intents (explore / debug / refactor   / extend / audit / review) and packs a token-budgeted,   source-attributed capsule. Each entry carries `stage` + `source_tool`   so you can see provenance.

## Anti-patterns

Avoid:

- `Read`-then-`Grep`-then-`Glob` chains on indexed repos. The index   already knows the answer; the chain wastes tokens.
- Searching with different keywords after `negative_evidence:   "no_implementation_found"`. The capability likely doesn't exist —   report the gap.
- Reading full files when `get_file_outline` would do.
- Calling primitives (`find_references` + `get_symbol_source` + ...)   separately when `assemble_task_context` or `get_context_bundle`   produces the whole capsule in one call.

## After editing

- If PostToolUse hooks are installed (Claude Code), edits are   auto-reindexed.
- Otherwise: `register_edit({"paths": [...]})` invalidates caches   and refreshes the index for those files.

## Multi-process awareness (v1.106.0)

If multiple agent sessions share this repo, `get_watch_status` surfaces `watcher_holder` per repo (pid, client_id, started_at, age_seconds). When `watched_by_another_process: true`, our watcher is intentionally idle — another process is keeping the index fresh.

## Tier model

The server narrows the exposed tool list based on the model you report via `plan_turn`'s `model` parameter. To get the right tier:

- Pass the exact model ID from your system prompt ("The exact model ID is …") — never a hardcoded version.
- Mapping is by substring (`~/.code-index/config.jsonc → model_tier_map`): `claude-opus` → full, `claude-sonnet` → standard, `claude-haiku` → core, anything else → `*` = full.

If `plan_turn` doesn't fit a given task, call `announce_model({"model": "..."})` once and proceed.

## Tool reference

The full canonical reference (with decision-tree bullet points matching the always-on preamble) follows. This restatement is intentional — when the skill is loaded the agent shouldn't need to also have the preamble in context.

## Code Exploration Policy

Always use jCodemunch-MCP tools for code navigation. Never fall back to Read, Grep, Glob, or Bash for code exploration.
**Exception:** Use `Read` when you need to edit a file — the agent harness requires a `Read` before `Edit`/`Write` will succeed. Use jCodemunch tools to *find and understand* code, then `Read` only the specific file you're about to modify.

**Start any session:**
1. `resolve_repo { "path": "." }` — confirm the project is indexed. If not: `index_folder { "path": "." }`
2. `suggest_queries` — when the repo is unfamiliar

**Finding code:**
- symbol by name → `search_symbols` (add `kind=`, `language=`, `file_pattern=`, `decorator=` to narrow)
- decorator-aware queries → `search_symbols(decorator="X")` to find symbols with a specific decorator (e.g. `@property`, `@route`); combine with set-difference to find symbols *lacking* a decorator (e.g. "which endpoints lack CSRF protection?")
- string, comment, config value → `search_text` (supports regex, `context_lines`)
- database columns (dbt/SQLMesh) → `search_columns`

**Reading code:**
- before opening any file → `get_file_outline` first
- one or more symbols → `get_symbol_source` (single ID → flat object; array → batch)
- symbol + its imports → `get_context_bundle`
- specific line range only → `get_file_content` (last resort)

**Repo structure:**
- `get_repo_outline` → dirs, languages, symbol counts
- `get_file_tree` → file layout, filter with `path_prefix`

**Relationships & impact:**
- what imports this file → `find_importers`
- where is this name used → `find_references`
- is this identifier used anywhere → `check_references`
- file dependency graph → `get_dependency_graph`
- what breaks if I change X → `get_blast_radius`
- what symbols actually changed since last commit → `get_changed_symbols`
- find unreachable/dead code → `find_dead_code`
- class hierarchy → `get_class_hierarchy`

## Session-Aware Routing

**Opening move for any task:**
1. `plan_turn { "repo": "...", "query": "your task description", "model": "<your-model-id>" }` — get confidence + recommended files; the `model` parameter narrows the exposed tool list to match your capabilities at zero extra requests.
2. Obey the confidence level:
   - `high` → go directly to recommended symbols, max 2 supplementary reads
   - `medium` → explore recommended files, max 5 supplementary reads
   - `low` → the feature likely doesn't exist. Report the gap to the user. Do NOT search further hoping to find it.
3. **One-call shortcut for a concrete task** — `assemble_task_context { "repo": "...", "task": "..." }` returns a single token-budgeted, source-attributed context capsule. It auto-classifies the task (explore / debug / refactor / extend / audit / review), auto-extracts anchor symbols, and runs the intent-appropriate sequence of the tools below end-to-end — so you get the whole context in one request instead of chaining the primitives by hand. Prefer it over a manual chain when the task is well-defined; fall back to step 1's routing when you need to decide *whether* the feature exists first.

**Interpreting search results:**
- If `search_symbols` returns `negative_evidence` with `verdict: "no_implementation_found"`:
  - Do NOT re-search with different terms hoping to find it
  - Do NOT assume a related file (e.g. auth middleware) implements the missing feature (e.g. CSRF)
  - DO report: "No existing implementation found for X. This would need to be created."
  - DO check `related_existing` files — they show what's nearby, not what exists
- If `verdict: "low_confidence_matches"`: examine the matches critically before assuming they implement the feature

**After editing files:**
- If PostToolUse hooks are installed (Claude Code only), edited files are auto-reindexed
- Otherwise, call `register_edit` with edited file paths to invalidate caches and keep the index fresh
- For bulk edits (5+ files), always use `register_edit` with all paths to batch-invalidate

**Token efficiency:**
- If `_meta` contains `budget_warning`: stop exploring and work with what you have
- If `auto_compacted: true` appears: results were automatically compressed due to turn budget
- Use `get_session_context` to check what you've already read — avoid re-reading the same files

## Model-Driven Tool Tiering

Your jcodemunch-mcp server narrows the exposed tool list based on the model you are running as. To avoid wasting requests on primitives when a composite would do, always include `model="<your-model-id>"` in your opening `plan_turn` call.

Replace `<your-model-id>` with the exact model ID from your system prompt ("The exact model ID is …") — never a hardcoded version. Non-Claude runners: the model id as your runner prints it.

The `model=` parameter rides on the existing `plan_turn` call — it does **not** add a separate tool invocation. If `plan_turn` is not appropriate for a non-code task, call `announce_model(model="...")` once instead.
