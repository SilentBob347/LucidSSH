# Triage labels

The `triage` skill speaks in terms of two canonical category roles and five canonical state roles. This file maps those roles to the actual GitHub label strings used in this repo (`https://github.com/Xykyma/LucidSSH`).

## Category roles

| Canonical role | Label in this repo | Meaning                        |
| --------------- | ------------------- | ------------------------------- |
| `bug`           | `bug`                | Something is broken             |
| `enhancement`   | `enhancement`        | New feature or improvement      |

## State roles

| Canonical role     | Label in this repo | Meaning                                 |
| ------------------- | ------------------- | ----------------------------------------- |
| `needs-triage`      | `needs-triage`       | Maintainer needs to evaluate              |
| `needs-info`        | `needs-info`         | Waiting on reporter for more information  |
| `ready-for-agent`   | `ready-for-agent`    | Fully specified, ready for an AFK agent   |
| `ready-for-human`   | `ready-for-human`    | Needs human implementation                |
| `wontfix`           | `wontfix`            | Will not be actioned                      |

All five state labels and both category labels use the default vocabulary — no renaming needed, no risk of colliding with GitHub's stock label set (`documentation`, `duplicate`, `good first issue`, `help wanted`, `invalid`, `question` stay untouched and out of scope for triage).

Every triaged issue should carry exactly one category label and one state label (see `issue-tracker.md` and the `triage` skill itself for the state machine and workflow).

**PRs as a triage surface:** off (see `issue-tracker.md`). Not raised for reconsideration here — flip it there if that changes.
