# AGENTS.md

Guide for AI agents (Claude Code, Antigravity, or similar) working on this repository. Read `CONTRIBUTING.md` first — it has the architectural invariants, engineering gates, project layout, and changelog process. Nothing from it is repeated here; this file only covers things specific to working as an agent rather than a human contributor.

## Confirm code state before acting on prior context

Agents often carry forward planning notes, chat summaries, or prior-session context that may not reflect what's actually in the code. Before building on a decision described as "agreed" or a piece described as done, verify it in the files — see CONTRIBUTING.md's "Architectural Invariants" for the specific list of things that have been decided but not implemented, and things that have regressed before. That list goes stale between sessions faster than the code does — don't trust your own summary of a past conversation over a grep.

## Treat the check gate as mandatory, not a PR formality

CONTRIBUTING.md documents `npm run typecheck && npm run lint && npm run test` as a pre-PR step for human contributors. For an agent, there is often no human reviewing the change before it lands. Run the full gate yourself before considering any task done — a failing check is not something to leave for someone else to catch.

## Changelog entries land in the same task

Same reasoning: add the `CHANGELOG.md` entry (see CONTRIBUTING.md's "Releases and the changelog") as part of the task that makes the change, not as a follow-up — there's no reviewer to nudge you into doing it later.
