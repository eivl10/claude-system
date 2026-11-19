---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use only when the user explicitly asks to stress-test a plan, get grilled on their design, or says "grill me".
---

Interview the user relentlessly about every aspect of their plan until you reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.

## How to ask questions

Antigravity has no multiple-choice popup tool. Ask in plain chat text.

Ask **one question at a time**. Stop after the question and wait for the user's answer before moving to the next. This keeps the conversation focused and prevents overwhelm.

For each question, give 2-4 concrete numbered options representing the most likely answers or directions, and mark your recommended one. Think about what the user would realistically choose; generic "Yes" / "No" options aren't helpful unless the question is genuinely binary. Always allow a free-form answer.

## Flow

1. After receiving an answer, briefly acknowledge the decision (1-2 sentences max), then immediately ask the next question.
2. If a question can be answered by exploring the codebase or files, explore them yourself instead of asking the user.
3. Continue until all branches of the design tree are resolved.
4. When finished, provide a concise summary of all decisions made.
