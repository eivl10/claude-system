---
name: readme
description: Create or refresh a project's README.md — the durable "what is this, why does it exist, what was originally asked for" doc, distinct from session state (handoff) and bug/decision history (FIXES.md). Trigger — starting a new project once it has real shape, the user asks to "напиши README", "задокументируй проект", or a fresh agent can't tell what the project is for/what was originally requested because no README (or a thin one) exists.
---

# README

Writes the one doc meant to outlive any single session: what this project *is*, why it exists, what was originally asked for, and how to work in it. Not per-round status (that's `handoff`), not a decision/bug log (that's `FIXES.md` via `no-regressions`). README changes rarely — on architecture shifts or scope changes, not on every commit.

## Boundary with the other two docs — hard rule, not a suggestion

| Doc | Answers | Lifespan | Skill |
|---|---|---|---|
| `README.md` | what is this, why, what was asked for originally, how do I run it | stable, updated on real architecture/scope change | this one |
| `FIXES.md` | what broke, what was decided, why the obvious fix was wrong | append-only history | `no-regressions` |
| `HANDOFF.md` / `HANDOVER_ROUNDn.md` | where things stand *right now*, mid-task | one round/session, then superseded | `handoff` |

**If README exists, `handoff` never repeats stack/structure/deploy/roles — it links.** That's not a soft preference, it's the point of having three docs instead of one: each fact lives in exactly one place. If a `handoff` document is carrying "Устройство" content that hasn't changed this round, that content belongs here instead — move it, don't leave it duplicated in both.

The one exception: if README doesn't exist yet, `handoff` may inline a *minimal* stopgap for the immediate task — but it must flag that content as temporary and point at this skill, not let the stopgap calcify into a permanent substitute for a real README.

## When NOT to use this

- Project has no real shape yet (a few exploratory files, nothing decided) — writing a README now just means rewriting it in a week. Wait until there's an actual architecture to describe.
- Don't use this for a status update or a "what changed this session" — that's `handoff`.
- Don't draft the prose yourself line-by-line — per the Delegation Policy, documentation writing routes to Gemini via `agy`. Your job is gathering verified facts, the purpose statement, and the original brief; agy's job is turning them into readable prose. Don't let agy invent architecture or motivation it wasn't given — feed it facts, not a vague prompt.

## Steps

1. **Get the purpose — in full, not a tagline.** "Why does this exist, what problem does it solve, who's it for, what does success look like" often isn't derivable from code. If it's not clear from the conversation, ask the user directly rather than guessing. This is the one section in the whole document that isn't independently verifiable against the repo — get it right, don't compress it to one throwaway line.
2. **Capture the original ТЗ/brief — close to verbatim, not paraphrased into something vaguer.** If this README is being written from the conversation where the user first described the project, pull the actual brief: what they asked for, any explicit constraints or non-goals stated at the time. This is the single most perishable piece of context in the whole system — it typically exists only in a chat that's about to be cleared, and unlike architecture it can't be reconstructed later by reading the code, because the code shows what got built, not what was asked. If the project already exists and the original brief isn't in the current conversation, check project memory files or ask the user whether it's written down somewhere before reconstructing it from current scope (current scope may have drifted from the original ask — see step 1 of `no-regressions`-style thinking: don't assume the current state was always the goal).
3. **Note scope drift, if any.** If what's built now differs from the original ТЗ, say so in one line ("изначально просили X, сейчас Y — почему, см. FIXES.md" if it was a real decision, otherwise just "разрослось из X"). Don't silently let the original brief and current reality contradict each other without a bridge.
4. **Gather the facts** — stack, folder structure, entry points, roles/key entities, how to run locally, how it deploys. Pull this from the actual repo (jcodemunch `get_repo_outline` / `get_file_tree` / `get_project_intel`), not from memory or assumption. Check for an existing `HANDOFF.md`/`FIXES.md`/access doc to link rather than duplicate.
5. **Draft** — hand agy a fully-specified prompt: the purpose (step 1), the original brief (step 2), scope drift (step 3), and the verified facts (step 4), plus the section list below. Don't ask it to figure out what the project does or why; tell it.
6. **Verify** — read the draft against the actual repo and against what the user actually said. Kill anything agy inferred that isn't backed by steps 1-4. A confidently-written wrong sentence here is worse than no README, because the next agent trusts it.
7. **Write it** — `README.md` at the project root. If one exists, update in place; don't fork a second "real" README.

## Language

Russian by default, matching the project's own docs (`FIXES.md`, handoff files) — unless the project is public-facing or has a stated English audience (open source, external contributors), in which case follow that.

## Format template

```markdown
# <Project name>

<one-line elevator pitch>

## Зачем это существует
<описывается проект: что это, как работает, какая проблема/повод, для кого, что считается успехом. Детально, чтобы любой человек или агент понял суть>

## Исходное ТЗ
<близко к дословному: что именно просил пользователь на старте, какие были ограничения/не-цели. Если объём с тех пор изменился — одна строка про дрейф, см. шаг 3>

## Что умеет / что не входит в объём
[Features / explicit non-goals, если есть]

## Стек и архитектура
...

## Структура
...

## Как запустить локально
...

## Деплой
[если применимо — prod URL, хост, деплой-команда или ссылка на регламент]

## Роли / ключевые сущности
[если применимо]

## Статус
[коротко, редко обновляется: MVP / в проде с <дата> / заморожен. Это НЕ таблица статусов задач раунда — та живёт в handoff]

## Другие документы
- `FIXES.md` — история багов и решений
- `HANDOFF.md` / `HANDOVER_ROUNDn.md` — состояние на конкретный раунд
- доступы — <where, not values>
```

## Do not

- Don't write a changelog or a decision log in here — that's `FIXES.md`.
- Don't write current task/round status in here — that's `handoff`. The "Статус" section above is coarse and stable ("in production since X"), not the per-task table handoff keeps.
- Don't include secret values — locations only, same rule as `handoff`.
- Don't let the purpose or original-ТЗ sections go stale. If reality has drifted from what's written, that's worth a one-line fix even outside a full refresh.
- Don't scaffold a README for a project that isn't real yet.
- Don't paraphrase the original ask into something blander than what the user actually said — the specific wording is often the useful part.
- Don't duplicate stack/structure/deploy/roles into `handoff` once they live here — that defeats the point of having both docs.
