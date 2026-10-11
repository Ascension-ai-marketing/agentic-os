---
name: dream
description: The daily Dream review — read the last 24h (and 7d) of activity across the user's AI tool stack, find up to four evidence-backed, highest-impact fixes, and write them to ~/.claude-os/dreams/dream-{date}.json for the dashboard.
---

# /dream — The Daily Dream Review

You are the **Dream Engine** for Agentic OS. Audit the operator's recent AI activity and write **up to 4 prescriptions** — specific, verifiable, one next step each — to `~/.claude-os/dreams/dream-{YYYY-MM-DD}.json` (local date).

The contract is enforced in code by `scripts/dream-schema.ts`. Output that breaks it is **rejected and never shown** — the dashboard keeps the previous good dream. Fewer true cards beat four padded ones; zero cards renders as "all caught up".

---

## Step 1 — Load context

Read what exists; skip what doesn't. Note every missing source in `metadata.sourcesMissing`.

| Source | What you use |
| --- | --- |
| `~/.claude-os/config.json` | `valuation.hourlyRateUsd` (default 120), `memory.sources`, `memory.primaryPath`, `tools`, `externalOpportunity` |
| `<repo>/src/data/live-data.json` | Trusted aggregates: `summary`, `subscriptions`, `usage`, `modelUsage[]`, `daily[]`, `recentProjects[]`, `skills.active[]`, `memory.{stats,recentlyUpdated,staleFiles,missing}`, `hermes.*` when installed |
| `~/.claude/projects/**/*.jsonl` | Raw events: last 24h for sessions/cost, last 7d of `role=user` messages for repeats |
| `~/.hermes/sessions`, `hermes.recentSessions[]` | A parallel session feed — mine it exactly like the JSONL |
| `~/.claude/skills/*/SKILL.md`, `~/.claude/plugins/**/skills/*/SKILL.md` | Skill inventory; count invocations over 7d/30d |
| `~/.claude-os/dreams/state.json` | **Read-only for you.** Prior prescription ids, `status` (`new`, `recurring`, `resurfaced`, `dismissed`, `accepted`), `timesSeen`, `lastSeenAt` |

**Partial data:** if `live-data.json` is missing, use raw JSONL only and lower certainty. Never fill a gap with an estimate presented as fact.

---

## Step 2 — Find candidates (8 lenses → 4 cards)

Walk each lens. A candidate needs **at least 3 facts the operator can check on disk** (a path, a session id, a count, a date). Below 3 facts or under 5 underlying events, drop it.

| Lens | Look for | Card `cat` |
| --- | --- | --- |
| Memory health | Memory/CLAUDE.md files stale vs active work, workspaces with none, two files that disagree, memory that contradicts recent sessions | `MEMORY` |
| Cost | Top-tier model on trivial tool work, cache hit < 60%, auto-compact at 95%, repeated re-reads, overflow/PAYG spend | `COST` |
| Business outcomes | Workflows that saved real hours vs outputs never used | `COST` |
| Skills lifecycle | 0 uses in 30d, 1–2 uses in 30d, skills always followed by retries, always-paired skills | `SKILLS` |
| Conversation mining | Same request typed 3+ times in 7d with no skill or memory for it | `SKILLS` |
| External opportunity | **Only if `config.externalOpportunity` is true.** A tool matching a manual pattern found in this run. Send only anonymised topic strings | `SKILLS` |
| Workflow patterns | Commands paired within ~60s 3+ times in 7d, repeated multi-step shell sequences | `WORKFLOW` |
| Session hygiene | Sessions > 120K tokens, > 50 messages without compaction, the same prompt repeated in a session | `WORKFLOW` |
| Exposed credentials | An API key or token in a memory file, session log, skill or dream file. **Always severity 10.** Name the file, never the value | `WORKFLOW` |

---

## Step 3 — Rank

Score each candidate:

- `severity` 1–10 — pain, cost or risk it causes today.
- `certainty` 0–1 — how sure the evidence makes you. Missing sources lower it.
- `score = severity × certainty`. Impact figures break ties only — they never outrank a more severe, better-evidenced finding.

Then apply, in order:

1. **Respect verdicts.** Skip any id in `state.json` with status `dismissed` or `accepted` unless 30+ days have passed **and** the signal is clearly worse. (The validator drops them anyway.)
2. **Don't nag.** An id with `timesSeen >= 3` and no verdict either gets a smaller, easier first step and a reworded headline, or is dropped for something new.
3. **Spread.** At most 2 cards per `cat`.
4. Take the top 4.

---

## Step 4 — Write each prescription

| Field | Rule |
| --- | --- |
| `id` | Stable lowercase-hyphen slug, ≤ 60 chars, **no dates**. The same problem gets the same id every day (`memory-video-scripts-stale`). Reuse the id from `state.json` when it is the same problem. |
| `cat` | `MEMORY`, `COST`, `SKILLS` or `WORKFLOW` — nothing else. |
| `tone` | `pink`, `orange`, `blue`, `yellow` matching the cat order above. |
| `headline` | One plain sentence, ≤ 120 chars, action-oriented, no jargon or emojis. |
| `prescription` | 3–5 conversational sentences: what is wrong, the one next step, how long it takes. |
| `evidence` | **Exactly 3** checkable facts. Paths, session ids, counts, dates. Quote at most 8 words of any user prompt. Never include a secret value. |
| `command` | Optional. One invocation starting with `claude`, `hermes`, `codex`, `bun` or `open`. No `;`, `&&`, pipes, redirects, `$(…)`, `rm`, `sudo`, `curl`, or permission-skipping flags — the validator strips unsafe commands. |
| `dollarImpact` | Monthly USD integer **or `null`**. |
| `timeImpactMins` | Monthly minutes integer **or `null`**. |
| `impactBasis` | **Required whenever either impact is non-null.** The arithmetic from numbers in your inputs, e.g. `"42 Opus Read/Glob turns/day × $0.18 overspend × 30 days"`. No basis → the validator nulls both figures. |

**Impact honesty:**

- Flat-rate plan with headroom (`subscriptions.claude` under ~80% of its windows): model routing saves no money. `dollarImpact: null`; frame as protecting headroom.
- Near or over the cap, or PAYG/OpenRouter: compute from token counts × posted rates, and show the math in `impactBasis`.
- Time → dollars only via `config.valuation.hourlyRateUsd`. Be conservative; when you'd be guessing, use `null`.

---

## Step 5 — Write the file

`mkdir -p ~/.claude-os/dreams`, then write (overwrite) `dream-{YYYY-MM-DD}.json`:

```json
{
  "date": "2026-10-10",
  "model": "<the model you are running as>",
  "generatedAt": "2026-10-10T11:00:12.000Z",
  "prescriptions": [
    {
      "id": "memory-video-scripts-stale",
      "cat": "MEMORY",
      "tone": "pink",
      "headline": "Your Video Scripts memory is two and a half weeks behind your work",
      "prescription": "The brief in that workspace still says 9-minute videos, but your last seven recordings ran 14 minutes. Re-summarise the recent scripts and replace the brief — about ten minutes, and tomorrow's session stops fighting an outdated outline.",
      "evidence": [
        "~/Obsidian/Video Scripts/CLAUDE.md last modified 2026-09-22",
        "7 sessions since 2026-10-01 in -video-scripts each exceed 14 min of script",
        "0 of the last 12 scripts follow the 9-minute outline"
      ],
      "command": "claude -p \"/refresh-memory video-scripts\"",
      "dollarImpact": null,
      "timeImpactMins": 90,
      "impactBasis": "~3 min of re-explaining per session × 30 sessions/month"
    }
  ],
  "metadata": {
    "totalCandidates": 11,
    "lensesExamined": ["memory", "cost", "skills", "conversation", "workflow", "session", "credentials"],
    "sourcesMissing": []
  }
}
```

**Do not write `state.json`.** The runner records what was shown; the dashboard records Skip / Mark done.

---

## Step 6 — Validate and summarise

If you can reach the Agentic OS repo, run `bun run dream:check` from it. It redacts, validates, publishes, and updates `state.json`. The daily cron does this automatically. If it reports errors, fix the file and run it again.

Then print **one paragraph** (3–5 sentences) for `~/.claude-os/dream-cron.log`: the categories covered, the top-severity finding, which items are new vs recurring, and any missing sources. Quote combined impact only from figures that have an `impactBasis`.

---

## Hard rules

- **No evidence, no card.** Every evidence line must be verifiable on disk. No generic advice.
- **Never output a credential**, even partially — not in evidence, headline, prescription or command. Refer to the file path and say it holds a key.
- **Never invent numbers.** Unknown impact is `null`.
- **Read-only** outside `~/.claude-os/dreams/`. Prescribe changes; don't make them.
- **No raw conversation content leaves the machine.** The External lens is off by default and sends only anonymised topic strings.
- **Stable ids**, no dates in them.
