export default {
  '*.md': (filenames) => {
    const files = filenames.filter((f) => !f.endsWith('README.md'));
    return files.length > 0 ? `pnpm exec oxfmt ${files.join(' ')}` : [];
  },
  '*.{json,jsonc,yml,yaml}': (filenames) => {
    const files = filenames.filter((f) => !f.includes('pnpm-lock.yaml'));
    return files.length > 0 ? `pnpm exec oxfmt ${files.join(' ')}` : [];
  },
  '*.{js,ts,mjs,cjs}': (filenames) => [
    `pnpm exec oxlint --fix --deny-warnings ${filenames.join(' ')}`,
    `pnpm exec oxfmt ${filenames.join(' ')}`
  ],
  // Rust: CI gates on `cargo fmt --all --check`. The crate is edition 2021 with
  // no rustfmt.toml, so `rustfmt --edition 2021 <files>` matches CI's defaults
  // exactly — formatting staged files here keeps that gate green locally.
  '*.rs': (filenames) => `rustfmt --edition 2021 ${filenames.join(' ')}`
};
