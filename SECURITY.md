# Security Policy

*Если удобнее написать по-русски — пишите, отвечу по-русски. Сам этот документ — на английском, это стандартная практика для security-репортов.*

## Reporting a vulnerability

Please **do not** open a public GitHub Issue for security vulnerabilities.

Instead, report it privately through GitHub's built-in mechanism:

**[Report a vulnerability](https://github.com/Xykyma/LucidSSH/security/advisories/new)**

This creates a private advisory visible only to the maintainer until it's resolved.

Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce (or a proof of concept)
- The version of LucidSSH affected
- Any relevant logs or screenshots (make sure they contain no real hostnames, credentials, or personal data)

## Response expectations

This is a solo-maintained project. I'll do my best to acknowledge reports within a few days and to keep you updated as I investigate. There's no guaranteed SLA, but security reports are treated as a priority over other work.

## Scope

**In scope:**

- Bypassing the Dangerous Command Guard (GUARD-*) without user confirmation
- Leaking secrets (passwords, private keys, masked history entries) to disk, logs, or over the network in plaintext
- Issues with how credentials are stored or retrieved via Windows Credential Manager
- Command/code injection through host configuration, snippets, or the command catalog
- SSH host key / fingerprint verification bypass
- Any way for a remote server to execute unintended code on the user's Windows machine beyond the SSH session itself

**Out of scope:**

- Denial-of-service against your own local machine (e.g., crashing the app with malformed local input)
- Issues that require physical access to an already-unlocked, already-compromised machine
- Vulnerabilities in third-party dependencies without a demonstrated, reachable exploit path in LucidSSH itself (please report those upstream instead, though a heads-up is still welcome)
- The absence of a code-signing certificate in v1.0 — this is a known, documented, deliberate decision, not a vulnerability

## Disclosure

I'll credit reporters (if they want) in the release notes once a fix ships, unless you'd prefer to stay anonymous — just let me know in your report.
