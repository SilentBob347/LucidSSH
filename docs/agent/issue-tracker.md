# Issue tracker: Local Markdown

Issues and specs (you may know a spec as a PRD) for this repo live as markdown files in `.scratch/`.

The repo has a public GitHub remote (`https://github.com/Xykyma/LucidSSH.git`), but the GitHub Issues tracker is not actively used — treat `.scratch/` as the source of truth for issue/spec workflow, not GitHub Issues.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` — never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## Triage labels

The `triage` skill is not installed in this repo, so no label vocabulary applies. If `triage` is added later, re-run `/setup-matt-pocock-skills` to record label mappings.

## Relationship to TZ.md

`private/TZ.md` is this project's existing requirements registry (ID scheme `HM-xx`, `TERM-xx`, `SNIP-xx`, `OQ-xx`, acceptance criteria; not published — see the project's private/public doc split). Issues/specs under `.scratch/` reference TZ IDs where relevant but do not replace or duplicate them — TZ.md stays the single source of truth for requirement IDs and acceptance criteria.

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` — the Notes / Decisions-so-far / Fog body.
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.

## Git commits

No skill (including `/implement`) runs `git commit` on its own in this repo. Prepare changes and propose a commit message; the developer runs the actual commit after approving it. See `CLAUDE.md` §8 for the project's full commit conventions (Conventional Commits, version-bump-as-separate-commit, etc.).
