# Security Policy

## Scope

`glimpse` is a **desktop application** (Tauri + Nuxt) that reads from local Git repositories on the user's machine. It executes Git operations and watches the filesystem, so security issues centre on local trust boundaries rather than network services.

The supported version is always the **latest release** on the tip of `main`. Fixes are not back-ported to older releases — please upgrade to the latest version.

## Reporting a Vulnerability

**Please do not file a public GitHub issue for security problems.**

In the context of glimpse, a "vulnerability" typically means:

- A path traversal or command injection via crafted repository data (branch names, paths, commit metadata).
- An overly permissive Tauri allowlist / IPC surface exposing host capabilities to the webview.
- Arbitrary code execution triggered by opening or watching a malicious repository.
- A dependency (npm or Cargo) that introduces a known CVE.

Use one of the following private channels:

1. **GitHub Private Vulnerability Reporting** (preferred): open a private advisory at <https://github.com/TitusKirch/glimpse/security/advisories/new>.
2. **Email**: [titus.kirch@kirch.dev](mailto:titus.kirch@kirch.dev). PGP available on request.

Please include:

- A description of the vulnerability and its impact on users.
- Steps to reproduce.
- Any suggested fix, if you have one.

### What to expect

| Stage                        | Target timeline                                   |
| :--------------------------- | :------------------------------------------------ |
| Acknowledgement of report    | within **3 business days**                        |
| Initial assessment & triage  | within **7 business days**                        |
| Patch released (if accepted) | depends on severity — critical issues prioritised |
| Public disclosure & advisory | coordinated with reporter after the patch ships   |

## Credit

Reporters who follow this process responsibly are credited in the [CHANGELOG](CHANGELOG.md) and the corresponding GitHub Security Advisory, unless they prefer to remain anonymous.

---

Maintained by [Titus Kirch](https://github.com/TitusKirch/) / [IT-Dienstleistungen Titus Kirch](https://kirch.dev).
