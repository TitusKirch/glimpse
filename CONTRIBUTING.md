# Contributing to glimpse

Thanks for contributing! 👀 This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting issues

- **Bugs:** [Bug report](https://github.com/TitusKirch/glimpse/issues/new?template=bug_report.yml), with a minimal reproduction if possible.
- **Features:** [Feature request](https://github.com/TitusKirch/glimpse/issues/new?template=feature_request.yml).
- **Questions, ideas or possible bugs:** the [Discord forum](https://discord.kirch.dev/).
- **Security vulnerabilities:** never a public issue. Follow [SECURITY.md](SECURITY.md).

## Setup

You need Node **24+**, **pnpm 12**, stable **Rust** with the [Tauri prerequisites](https://tauri.app/start/prerequisites/), and `git`.

```bash
git clone https://github.com/TitusKirch/glimpse.git
cd glimpse
pnpm install   # wires husky hooks
```

`pnpm check` runs the CI gate (lint, format, typecheck, `cargo fmt`, tests), and `pnpm check:fix` auto-fixes what it can. The full command list is in [AGENTS.md](AGENTS.md#commands).

## Branches, commits and PRs

- Branch off `dev` and open PRs against `dev`. `main` only receives release promotions.
- Use [Conventional Commits](https://www.conventionalcommits.org/), which commitlint enforces. Mark breaking changes with `!` or a `BREAKING CHANGE:` footer.
- Keep one concern per PR, and update the README or docs when you change behaviour or a default.
- Husky runs oxlint/oxfmt (JS/TS/JSON/YAML/TOML/MD) and rustfmt (`*.rs`) on commit. Fix any failure instead of using `--no-verify`.

## Coding agents

Agent instructions live in [AGENTS.md](AGENTS.md). Claude Code (v2.1.277+) loads it on its own as long as no `CLAUDE.md` or `CLAUDE.local.md` is in the working directory or above it. Don't add a `CLAUDE.md`; a personal `CLAUDE.local.md` stays untracked.

## License

Contributions are licensed under the [MIT License](LICENSE).
