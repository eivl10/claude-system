---
name: jdocmunch
description: Use jDocMunch MCP tools for section-level documentation navigation instead of raw Read. Loads on demand; complements the always-on Doc Exploration Policy block.
---

# jDocMunch Documentation Exploration Skill

Load this skill when navigating documentation, searching for concepts, tracing doc coverage, or reading large doc sets. The jdocmunch MCP server provides section-level retrieval via byte-offset seeking — no full-file reads, no wasted tokens.

## When to load this skill

- Opening a session that involves reading or searching documentation
- Finding where a concept, API, or config option is explained
- Checking doc coverage against code
- Auditing broken internal links in a doc set
- Reading a specific section without loading an entire file

## When NOT to load this skill

- The task has no documentation component.
- You need exact line numbers for `Edit` — use `Read` for that (the policy block's exception).
- The doc set is not indexed and you don't intend to index it.

## Opening move

Before any doc exploration:

1. `doc_list_repos` — check what doc sets are indexed.
2. If the target docs aren't listed: `index_local { "path": "." }` (or the docs subdirectory).

## Finding content

Pick by question:

- "What sections mention X?" → `search_sections` (keyword/topic; returns summaries only, not full text)
- "What's the structure of this doc set?" → `get_toc` (flat list) or `get_toc_tree` (nested)
- "What sections are in this file?" → `get_document_outline`

## Reading content

Never `Read` a full doc file as a first move. The chain is:

- `get_section(section_id)` → fetch exactly one section by byte-range
- `get_sections([id, id, ...])` → batch fetch multiple sections at once
- `get_section_context(section_id)` → section + its ancestors and children (useful for understanding nesting)

## Maintenance

- Broken internal links → `get_broken_links`
- Code/doc coverage gap → `get_doc_coverage`

## Doc Exploration Policy

Always use jDocMunch-MCP tools for documentation navigation. Never fall back to Read for doc exploration.
**Exception:** Use `Read` when you need exact line numbers for `Edit`.

**Start any session:**
1. `doc_list_repos` — check what's indexed. If your docs aren't there: `index_local { "path": "." }`

**Finding content:**
- keyword/topic search -> `search_sections` (returns summaries only)
- browse structure -> `get_toc` (flat) or `get_toc_tree` (nested)
- single document -> `get_document_outline`

**Reading content:**
- one section -> `get_section` (full content via byte-range)
- multiple sections -> `get_sections` (batch)
- section + context -> `get_section_context` (ancestors + children)

**Maintenance:**
- broken internal links -> `get_broken_links`
- code/doc coverage gap -> `get_doc_coverage`
