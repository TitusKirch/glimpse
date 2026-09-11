#!/bin/sh
# glimpse — the glimpse command line, and the desktop app's launcher, from a
# WSL shell.
#
# Two jobs, told apart by the first word, exactly as the installed binary tells
# them apart (`claims` in crates/glimpse-cli/src/lib.rs):
#
#     glimpse .          a path → open that repository in the desktop app
#     glimpse ../other   …
#     glimpse            …or just focus the app
#     glimpse status     a subcommand → run the headless command line
#     glimpse cl ls      …
#
# A subcommand takes the shortest route it can find:
#
#   1. the **native** Linux command line, if this distro has one — the
#      `glimpse-cli` binary the installer drops in, or a glimpse package already
#      installed here. It drives the distro's own git directly: no Windows hop,
#      no UNC share, and real stdout.
#   2. otherwise the **Windows** binary, with the repository translated to its
#      `\\wsl.localhost\<distro>\…` UNC form by `wslpath -w`. glimpse's git
#      engine routes that back through `wsl.exe -d <distro>`, so the same
#      repository is read either way — it just takes the long way round.
#
# Only the repository (`-C <dir>`) crosses the boundary as a path. Every other
# path argument is repo-root-relative on both sides and is passed through
# untouched; translating one would corrupt it.
#
# A path still goes to the GUI, which is a Windows app, so that job needs WSL.
# The path crosses the boundary as a normal argv — the trusted, local entry
# point — so no `glimpse://` deep link (and its confirmation) is involved.
#
# Install — copy onto your PATH as `glimpse`:
#     install -Dm755 glimpse-wsl.sh ~/.local/bin/glimpse
# Configure the Windows binary once (remembered in the config file below). Either
# a WSL-visible path or a Windows path (auto-converted) works:
#     glimpse --exe '/mnt/c/Users/<you>/AppData/Local/glimpse/glimpse.exe'
#     glimpse --exe 'C:\Users\<you>\AppData\Local\glimpse\glimpse.exe'
#
# (The glimpse app installs and configures this for you — Settings → General →
# Command line drops it into each WSL distro as /usr/local/bin/glimpse with the
# glimpse.exe path baked in. This file remains the canonical launcher and the
# manual fallback.)

set -eu

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/glimpse"
CONFIG_FILE="$CONFIG_DIR/cli.env"

# Every word the command line answers to: `SUBCOMMANDS` + `ALIASES` in
# crates/glimpse-cli/src/lib.rs, plus the spellings `claims` adds there. A
# subcommand missing from this list would work everywhere except inside a WSL
# shell, where it would be read as a path and die as `no such path` — which is
# the bug this routing exists to close, so a cargo test
# (`tests/wsl_shim.rs::the_launcher_routes_every_word_the_command_line_claims`)
# pins the list against those tables in both directions.
#
# `-h` / `--help` are deliberately absent. They stay the launcher's own, because
# a distro with neither route still has to be able to say what this command is,
# and this script's usage is the only answer available there. The bare word
# `help` does route, and that is where the full command list lives.
GLIMPSE_SUBCOMMANDS="status diff log show history blame branches tags remotes
stashes reflog worktrees submodules sparse stats info stage unstage discard
commit amend branch tag remote stash cherry-pick revert reset fetch pull push
rebase bisect resolve worktree submodule cl changelist sparse-checkout
file-history help -V --version"

die() {
	echo "glimpse: $1" >&2
	exit 1
}

usage() {
	cat <<EOF
glimpse — the glimpse command line and desktop launcher (WSL)

Usage:
  glimpse [path]            Open <path> (default: current directory) in glimpse
  glimpse <subcommand> …    Run a command headlessly (glimpse status, glimpse cl ls, …)
  glimpse help              List every subcommand
  glimpse --exe <glimpse>   Remember the path to glimpse.exe and exit
  glimpse -h, --help        Show this help

A subcommand runs against this distro's own git when a native glimpse command
line is installed here; otherwise it is forwarded to glimpse.exe, which reaches
the same repository over the \\\\wsl.localhost share.

The path to glimpse.exe is remembered in:
  $CONFIG_FILE
Set GLIMPSE_CLI to point at a native command line explicitly.
EOF
}

# The first word that is not a global option. `glimpse -C sub status` is the
# command line too, so the launcher looks past the globals exactly as the
# binary's `claims` does — otherwise `-C` would be treated as a path.
first_word() {
	while [ $# -gt 0 ]; do
		case "$1" in
		--json)
			shift
			;;
		-C | --repo)
			if [ $# -lt 2 ]; then
				return 0
			fi
			shift 2
			;;
		*)
			printf '%s' "$1"
			return 0
			;;
		esac
	done
	return 0
}

is_subcommand() {
	if [ -z "${1:-}" ]; then
		return 1
	fi
	for word in $GLIMPSE_SUBCOMMANDS; do
		if [ "$word" = "$1" ]; then
			return 0
		fi
	done
	return 1
}

# This script's own resolved path, so the native search below can never pick it.
self_path() {
	readlink -f "$0" 2>/dev/null || printf '%s' "$0"
}

# The native Linux command line, if this distro has one; empty if not. Printed
# rather than returned so the caller can test for it.
find_native() {
	if [ -n "${GLIMPSE_CLI:-}" ]; then
		if [ -x "$GLIMPSE_CLI" ]; then
			printf '%s' "$GLIMPSE_CLI"
		fi
		return 0
	fi
	for candidate in /usr/local/lib/glimpse/glimpse-cli /usr/lib/glimpse/glimpse-cli; do
		if [ -x "$candidate" ]; then
			printf '%s' "$candidate"
			return 0
		fi
	done
	# A `glimpse-cli` on PATH, or the Linux package's own `glimpse` — that one is
	# the GUI binary, which answers subcommands before it opens a window. But the
	# launcher is installed under that same name, so a candidate resolving to
	# this script is skipped: taking it would be an endless re-exec.
	self="$(self_path)"
	for name in glimpse-cli glimpse; do
		found="$(command -v "$name" 2>/dev/null || true)"
		if [ -z "$found" ]; then
			continue
		fi
		resolved="$(readlink -f "$found" 2>/dev/null || printf '%s' "$found")"
		if [ "$resolved" = "$self" ]; then
			continue
		fi
		printf '%s' "$found"
		return 0
	done
	return 0
}

# Reaching the Windows side is the only thing that needs WSL. The native route
# above does not, which is why this is a guard rather than a preamble.
require_wsl() {
	if [ -z "${WSL_DISTRO_NAME:-}" ] && ! grep -qi microsoft /proc/version 2>/dev/null; then
		die "this launcher is for WSL; on native Linux install the glimpse package"
	fi
	command -v wslpath >/dev/null 2>&1 || die "wslpath not found — is this really WSL?"
}

# A Windows path (C:\… or anything containing a backslash) is converted to its
# WSL-visible form; a bare name (glimpse.exe) or /mnt/… path is left as-is. WSL
# can only exec the Linux-visible path or a PATH name, never a raw C:\… string.
normalize_exe() {
	case "$1" in
	*'\'*) wslpath -u -- "$1" 2>/dev/null || printf '%s' "$1" ;;
	*) printf '%s' "$1" ;;
	esac
}

save_exe() {
	mkdir -p "$CONFIG_DIR"
	# Single-quote so spaces/backslashes survive sourcing on the next run.
	printf "GLIMPSE_EXE='%s'\n" "$1" >"$CONFIG_FILE"
	echo "glimpse: remembered $1" >&2
}

# Resolve glimpse.exe into GLIMPSE_EXE: env/config → glimpse.exe on PATH (the
# Windows PATH is appended to WSL's by default) → first-run prompt → error.
resolve_exe() {
	if [ -z "${GLIMPSE_EXE:-}" ] && [ -f "$CONFIG_FILE" ]; then
		# shellcheck source=/dev/null
		. "$CONFIG_FILE"
	fi
	if [ -z "${GLIMPSE_EXE:-}" ]; then
		if command -v glimpse.exe >/dev/null 2>&1; then
			GLIMPSE_EXE="glimpse.exe"
		elif [ -t 0 ]; then
			printf 'Path to glimpse.exe: ' >&2
			IFS= read -r GLIMPSE_EXE || die "no path given"
			[ -n "$GLIMPSE_EXE" ] || die "no path given"
			save_exe "$(normalize_exe "$GLIMPSE_EXE")"
		else
			die "glimpse.exe not configured — run: glimpse --exe '/mnt/c/…/glimpse.exe'"
		fi
	fi
	GLIMPSE_EXE="$(normalize_exe "$GLIMPSE_EXE")"
}

# The console binary beside glimpse.exe, when there is one. glimpse.exe is a
# GUI-subsystem program that can only attach to a parent console, so its output
# is best-effort — the wrong bargain for a command line, and the right one for a
# window, which is why only a subcommand asks for this.
console_exe() {
	case "$1" in
	*/*)
		dir="$(dirname "$1")"
		if [ -x "$dir/glimpse-cli.exe" ]; then
			printf '%s' "$dir/glimpse-cli.exe"
			return 0
		fi
		;;
	*)
		found="$(command -v glimpse-cli.exe 2>/dev/null || true)"
		if [ -n "$found" ]; then
			printf '%s' "$found"
			return 0
		fi
		;;
	esac
	printf '%s' "$1"
}

# Hand a subcommand to the Windows binary. The repository is named explicitly —
# translated if the caller gave one, injected from $PWD if not — rather than
# left to whatever working directory the interop layer hands the child, because
# that is the one thing which decides *which repository* answers.
forward_subcommand() {
	seen_repo=0
	remaining=$#
	while [ "$remaining" -gt 0 ]; do
		case "$1" in
		-C | --repo)
			if [ "$remaining" -ge 2 ]; then
				seen_repo=1
				win="$(wslpath -w "$2")" || die "could not translate to a Windows path: $2"
				set -- "$@" "$1" "$win"
				shift 2
				remaining=$((remaining - 2))
				continue
			fi
			;;
		esac
		set -- "$@" "$1"
		shift
		remaining=$((remaining - 1))
	done
	if [ "$seen_repo" -eq 0 ]; then
		here="$(wslpath -w "$PWD")" || die "could not translate to a Windows path: $PWD"
		set -- "-C" "$here" "$@"
	fi
	exec "$(console_exe "$GLIMPSE_EXE")" "$@"
}

# The launcher's own flags first, before touching the remembered config.
case "${1:-}" in
-h | --help)
	usage
	exit 0
	;;
--exe)
	[ $# -ge 2 ] || die "--exe needs a path to glimpse.exe"
	save_exe "$(normalize_exe "$2")"
	exit 0
	;;
esac

if is_subcommand "$(first_word "$@")"; then
	native="$(find_native)"
	if [ -n "$native" ]; then
		exec "$native" "$@"
	fi
	require_wsl
	resolve_exe
	forward_subcommand "$@"
fi

# Not a subcommand, so it is a path — the desktop app's job, and Windows'.
require_wsl
resolve_exe

# No path → just launch / focus the app (single-instance brings it to front).
if [ $# -eq 0 ]; then
	exec "$GLIMPSE_EXE"
fi

[ -e "$1" ] || die "no such path: $1"
abs="$(realpath "$1")" || die "could not resolve: $1"
unc="$(wslpath -w "$abs")" || die "could not translate to a Windows path: $abs"

exec "$GLIMPSE_EXE" "$unc"
