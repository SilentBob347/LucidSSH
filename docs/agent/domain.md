# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`docs/agent/CONTEXT.md`** — glossary and rationale for decisions, **not** a requirements registry.
- **`docs/agent/adr/`** (published) and **`private/adr/`** (not published) — read ADRs that touch the area you're about to work in, in both locations. An ADR lives in `private/adr/` instead of `docs/agent/adr/` when its rationale discloses business/monetization decisions or unreleased-feature specifics that fail the private/public doc-split criteria (see `CLAUDE.md`'s public/private note); otherwise it's public.

If any of these files don't exist yet, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## Non-default location

This repo places domain docs under `docs/agent/` instead of the repo root (the skill's usual single-context default is `CONTEXT.md` at root + `docs/adr/` alongside it). Always read/write to `docs/agent/CONTEXT.md` and `docs/agent/adr/` here, not the root.

## File structure (as used in this repo)

```
docs/agent/                        (published)
├── CONTEXT.md                     (not yet created — see below)
├── adr/
│   └── 0002-....md                (architecture-only ADRs)
├── issue-tracker.md   (this setup skill's own config)
└── domain.md           (this file)

private/adr/                       (not published)
├── 0001-....md                    (business/monetization ADRs)
└── 0003-....md
```

ADR numbering is a single global sequence across both directories — don't restart numbering in `private/adr/`. Scan both directories for the highest existing number before assigning a new one.

## `private/TZ.md` stays the requirements source of truth

This project already has a requirements registry: `private/TZ.md` (full version, not published — see the private/public doc split below), with its own ID scheme (`HM-xx`, `TERM-xx`, `SNIP-xx`, `OQ-xx`) and acceptance criteria. A trimmed public subset (implemented requirements only) is published at `docs/TZ.md`. `docs/agent/CONTEXT.md` must **not** duplicate or create a parallel requirements registry — it is a **glossary of terminology and a record of the rationale behind decisions** only. When a concept in `CONTEXT.md` corresponds to a TZ requirement, link to the TZ ID rather than restating the requirement.

Also check, before or alongside `CONTEXT.md`:
- `private/Design_Brief.md` — design intent, tokens, component behavior (not published)
- `docs/Data_Structures.md` — schemas for `hosts/`, `history/`, `errors/` (published)
- `docs/Security_Guide.md` — security rationale (keytar, keys, IPC, fingerprints, masking) (published)
- `src/renderer/components/` — implemented UI is the source of truth for screens, per `CLAUDE.md` §1

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `docs/agent/CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_

## Flag TZ conflicts

If your output contradicts or would require changing a `private/TZ.md` requirement, surface it explicitly and ask before proceeding — TZ.md and the implemented UI in `src/renderer/components/` outrank `CLAUDE.md` and `docs/agent/` per the project's own priority order (`CLAUDE.md` §1).
