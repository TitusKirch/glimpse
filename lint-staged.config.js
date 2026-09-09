import { readFileSync } from 'node:fs';
import path from 'node:path';

// oxfmt exits non-zero when EVERY file it is handed is excluded by its own
// ignore rules ("Expected at least one target file"), which turns the hook into
// a wall: a commit touching only an ignored file fails with an error about
// there being nothing to format. So the same exclusions have to be applied here
// before oxfmt is called at all.
//
// Read from `.oxfmtrc.json` rather than restated, because a hand-copied list is
// how the two drift — which is exactly what happened: the config ignored
// `src-tauri/tauri.conf.json`, `CHANGELOG.md` and `.release-please-manifest.json`
// while this file filtered only `pnpm-lock.yaml` and `README.md`, so any commit
// touching one of those three was blocked. It went unnoticed because
// release-please writes them in CI, where no hook runs.
const ignorePatterns =
  JSON.parse(readFileSync(new URL('.oxfmtrc.json', import.meta.url), 'utf8'))
    .ignorePatterns ?? [];

// The patterns oxfmt is given here are either a repo-relative path or a bare
// filename; directory globs like `**/node_modules/**` never match a staged file
// and are simply left to miss.
const formattable = (filenames) => {
  const root = path.dirname(new URL(import.meta.url).pathname);
  return filenames.filter((file) => {
    const rel = path.relative(root, file);
    return !ignorePatterns.some((p) => rel === p || path.basename(rel) === p);
  });
};

const oxfmt = (filenames) => {
  const files = formattable(filenames);
  return files.length > 0 ? `pnpm exec oxfmt ${files.join(' ')}` : [];
};

export default {
  '*.md': oxfmt,
  '*.{json,jsonc,yml,yaml,toml}': oxfmt,
  '*.{js,ts,mjs,cjs}': (filenames) => {
    const lint = `pnpm exec oxlint --fix --deny-warnings ${filenames.join(' ')}`;
    const format = oxfmt(filenames);
    return format.length > 0 ? [lint, format] : [lint];
  },
  // Rust: CI gates on `cargo fmt --all --check`. The crate is edition 2021 with
  // no rustfmt.toml, so `rustfmt --edition 2021 <files>` matches CI's defaults
  // exactly — formatting staged files here keeps that gate green locally.
  '*.rs': (filenames) => `rustfmt --edition 2021 ${filenames.join(' ')}`
};
