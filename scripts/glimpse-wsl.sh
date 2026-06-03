#!/bin/sh
# glimpse — open a git repository in the glimpse desktop app, from a WSL shell.
#
# glimpse's GUI is a Windows app, but WSL repos live in the Linux filesystem.
# This shim bridges the two: it translates the target path to the
# `\\wsl.localhost\<distro>\…` UNC form the Windows app understands (its git
# engine routes that back through `wsl.exe -d <distro>`), then launches the
# Windows binary with it. The path crosses the boundary as a normal argv — the
# trusted, local entry point — so no `glimpse://` deep link (and its
# confirmation) is involved.
#
# Install — copy onto your PATH as `glimpse`:
#     install -Dm755 glimpse-wsl.sh ~/.local/bin/glimpse
# Configure the Windows binary once (remembered in the config file below). Either
# a WSL-visible path or a Windows path (auto-converted) works:
#     glimpse --exe '/mnt/c/Users/<you>/AppData/Local/glimpse/glimpse.exe'
#     glimpse --exe 'C:\Users\<you>\AppData\Local\glimpse\glimpse.exe'
# Then, from any repo:
#     glimpse .          # open the current directory
#     glimpse ../other   # open another repo by path
#     glimpse            # just open / focus the app
#
# (A future glimpse release installs and configures this for you from the app;
# until then this is the canonical launcher.)

set -eu

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/glimpse"
CONFIG_FILE="$CONFIG_DIR/cli.env"

die() {
	echo "glimpse: $1" >&2
	exit 1
}

usage() {
	cat <<EOF
glimpse — open a git repository in the glimpse desktop app (WSL launcher)

Usage:
  glimpse [path]            Open <path> (default: current directory) in glimpse
  glimpse --exe <glimpse>   Remember the path to glimpse.exe and exit
  glimpse -h, --help        Show this help

The path to glimpse.exe is remembered in:
  $CONFIG_FILE
EOF
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

# This launcher only makes sense inside WSL (it reaches the Windows GUI). On a
# native Linux desktop the .deb already puts `glimpse` on the PATH.
grep -qi microsoft /proc/version 2>/dev/null ||
	die "this launcher is for WSL; on native Linux install the glimpse package"
command -v wslpath >/dev/null 2>&1 || die "wslpath not found — is this really WSL?"

# Flags first, before touching the remembered config.
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

# Load a remembered glimpse.exe path (GLIMPSE_EXE) unless already in the env.
if [ -z "${GLIMPSE_EXE:-}" ] && [ -f "$CONFIG_FILE" ]; then
	# shellcheck source=/dev/null
	. "$CONFIG_FILE"
fi

# Resolve glimpse.exe: env/config → glimpse.exe on PATH (Windows PATH is appended
# to WSL's by default) → first-run prompt → error.
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

# No path → just launch / focus the app (single-instance brings it to front).
if [ $# -eq 0 ]; then
	exec "$GLIMPSE_EXE"
fi

[ -e "$1" ] || die "no such path: $1"
abs="$(realpath "$1")" || die "could not resolve: $1"
unc="$(wslpath -w "$abs")" || die "could not translate to a Windows path: $abs"

exec "$GLIMPSE_EXE" "$unc"
