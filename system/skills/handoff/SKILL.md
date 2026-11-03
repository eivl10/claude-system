---
name: handoff
description: Compile a portable context-handoff document — task, decisions, bugs/fixes, access/secrets locations, open questions — before the user clears/compacts chat history, so the next agent (same chat, or a fresh one) can resume without re-deriving context. Trigger: "собери контекст", "handoff", "подготовь передачу", "перед тем как почищу историю", "summarize before /clear", or the user asks what to pass to the next agent.
---

# Handoff

One Markdown file with the *in-progress task state* of this session, for a hard break (`/clear`, new chat). Not permanent facts (auto-memory), not code history (`git log`, `FIXES.md`), not `/compact` (it drops the "why"), not jcodemunch `finalize_handoff` (code audit, wrong shape).

The file and the chat reply are in **Russian**. The file is complete; only the chat reply is short.

## Steps

1. Skim `MEMORY.md` and `FIXES.md` first. Don't restate what they hold, link it.
2. Collect what is NOT finished or verified, and where reality diverges from repo/docs (prod vs git, fix not deployed). These go into the status table; traps also into Мины.
3. Fill the template. Skip a section only if genuinely empty.
   - Files list is the first block, mandatory: absolute paths, only existing files. Missing README/FIXES: write "README.md — нет".
   - О проекте is mandatory even with README: 1-3 sentences, what and why, for a reader with zero context. No README but the project has shape: point at the `readme` skill, don't grow this line into one.
   - Устройство: if README exists, a link only. No README: minimal stopgap, marked as such.
   - Статус: "build passed" and "verified in browser" are different rows.
   - Решения и баги: if FIXES.md exists, append there and link. Else inline: what → why, what was rejected → outcome.
   - Как проверить: only if non-obvious (build ≠ correctness, curl checks, verify the file on disk, not the agent's report).
   - Мины: this session's plus still-valid ones from earlier handoffs. A mine stays until confirmed fixed.
   - Доступы: where things live, never values. Project access doc or `<VIBECODING>\_Доступы\`.
   - Регламент: process rules not in code or memory.
4. Write the file following the project's convention: numbered rounds (`HANDOVER_ROUND9` → next number, never overwrite), or one living `HANDOFF.md` updated in place. No convention: `HANDOFF.md` in the project root.
5. Chat reply, Russian, two parts, nothing else (no recap of the file):
   1. One line: link `[HANDOFF.md](relative/path)`, not in backticks.
   2. Ready-to-paste message for the new agent in its own ```` ```text ```` block, nothing else inside. Order:
      - starts with "Читай" + the absolute path to the handoff (no greeting, no preamble; README/FIXES paths are not repeated, they sit in the file)
      - the project's working folder
      - the single concrete next step
      - the one unfinished/diverging item, if any
      - last line: "Если что-то непонятно, сначала задай вопрос."
      - no secrets, paths are plain text

## Rules

- No secret values, no transcript dumps, no emoji, no warning callouts.
- Don't re-derive what code/git proves, link to it.
- Readability: one item per bullet or table row (no `·`/`;`/commas packing), blank line around headings, lists and tables, paragraphs of 1-3 sentences.

## Template

```markdown
# Handoff — <проект/задача> (<дата>)

## Файлы проекта

- README.md — <абсолютный путь>
- FIXES.md — <абсолютный путь>
- <прошлые handoff, access-док, ТЗ, .env — по пункту на файл>

## О проекте

<1-3 предложения: что это и зачем>

## Устройство

См. README.md

## Статус на передачу

| Блок | Статус |
|---|---|
| ... | готово и проверено в браузере / готово, не проверено / в процессе / заблокировано / расходится с репо |

## Решения и баги

См. FIXES.md — <путь>

## Как проверить

- ...

## Мины

Этого раунда:

- ...

Унаследованные, ещё актуальны:

- ...

## Доступы

- <что> — <где искать, не значение>

## Открытые вопросы

- ...

## Регламент

- ...
```
