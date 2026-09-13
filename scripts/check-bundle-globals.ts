#!/usr/bin/env node
// Guard against a Vue auto-import that never got injected.
//
// Nuxt injects `import { ref } from 'vue'` only when it decides the SFC does not
// already bind that name. Binding it anywhere in the file — a `v-for` alias, a
// function parameter — can make it skip the injection, and the four real `ref()`
// calls are then free references to a global that does not exist. The dev server
// hides this (its template is not inlined into `setup()`); the production bundle
// throws `ref is not defined` at the moment the component renders, which reaches
// the user as Nuxt's 500 page instead of the app.
//
// So the built bundle, not the source, is the thing worth checking: whatever the
// toolchain's scope analysis does this month, a Vue API that survived
// minification as a bare call is one the bundle never imported.
//
// Usage: node scripts/check-bundle-globals.ts [bundleDir]
// Exits 1 and lists file, identifier and surrounding source on any finding.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const bundleDir = resolve(process.argv[2] ?? '.output/public');

// The Vue APIs Nuxt auto-imports that this app actually uses. Deliberately not
// the whole preset: every name here has to survive minification to be a finding,
// and a name the app never calls can only ever produce noise.
const WATCHED = [
  'computed',
  'nextTick',
  'onBeforeMount',
  'onBeforeUnmount',
  'onMounted',
  'onUnmounted',
  'reactive',
  'ref',
  'shallowRef',
  'toRaw',
  'toRef',
  'toRefs',
  'unref',
  'watch',
  'watchEffect'
];

function jsFiles(dir: string): string[] {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...jsFiles(path));
    else if (entry.endsWith('.js') || entry.endsWith('.mjs')) out.push(path);
  }
  return out;
}

// Does the chunk bind this name itself? A bound name is not a free reference,
// however it got bound — an import from a sibling chunk, a declaration the
// minifier chose not to rename, a `catch` binding.
function isBound(code: string, name: string) {
  const patterns = [
    // import { ref } from … / import { r as ref } from …
    new RegExp(`import[^;]*[{,]\\s*(?:[\\w$]+\\s+as\\s+)?${name}\\s*[,}]`),
    // import ref from … / import * as ref from …
    new RegExp(`import\\s+(?:\\*\\s+as\\s+)?${name}\\s+from`),
    new RegExp(`\\b(?:var|let|const|function|class)\\s+${name}\\b`)
  ];
  return patterns.some((re) => re.test(code));
}

// Walk from the `(` of `name(` to its matching `)`, then look at what follows.
// A call is followed by an expression's continuation; a *definition* — an object
// or class method shorthand, `watch(e){…}` — is followed by its body. Skipping
// those is what keeps a minified library's own method names out of the report.
function isDefinition(code: string, openParen: number) {
  let depth = 0;
  for (let i = openParen; i < code.length; i++) {
    const ch = code[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        const rest = code.slice(i + 1, i + 3);
        return /^\s*\{/.test(rest);
      }
    }
  }
  return false;
}

// Blank out everything that is not executable code — string bodies, template
// literals (keeping their `${…}` interpolations, which are code), comments and
// regex literals — replacing each character with a space so every offset still
// lines up with the original. Without this the app's own translations trip the
// scan: "Branch / ref (optional)" reads as a call to `ref` otherwise.
function maskNonCode(code: string) {
  const out = code.split('');
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (out[i] !== '\n') out[i] = ' ';
  };
  // A `/` starts a regex rather than a division wherever an operand cannot have
  // just ended — the standard heuristic, and enough for generated bundles.
  const regexAllowedAfter = /[(,=:[!&|?{};+\-*%~^<>]$/;
  // One entry per template literal we are inside the `${…}` of, holding the
  // brace depth reached within that interpolation. Counting is what keeps an
  // ordinary `}` — an object or arrow body inside the interpolation — from
  // being read as the end of the interpolation, which would blank live code and
  // let a real finding through unseen.
  const interpolations: number[] = [];

  // Blank a run of template text starting at `from`, stopping at the literal's
  // closing backtick or at the `${` that opens the next interpolation. Returns
  // the index of whichever it found.
  const skipTemplateText = (from: number) => {
    let j = from;
    while (j < code.length) {
      if (code[j] === '\\') j += 2;
      else if (code[j] === '`') break;
      else if (code[j] === '$' && code[j + 1] === '{') break;
      else j++;
    }
    blank(from, j);
    return j;
  };

  let i = 0;
  let lastSignificant = '';
  while (i < code.length) {
    const ch = code[i];
    if (ch === '"' || ch === "'") {
      const start = i++;
      while (i < code.length && code[i] !== ch) i += code[i] === '\\' ? 2 : 1;
      blank(start + 1, i);
      i++;
      lastSignificant = ch;
      continue;
    }
    if (ch === '`') {
      i = skipTemplateText(i + 1);
      if (code[i] === '`') {
        i++;
        lastSignificant = '`';
      } else {
        interpolations.push(0);
        i += 2; // step into `${` — its contents are real code
        lastSignificant = '{';
      }
      continue;
    }
    if (interpolations.length > 0 && (ch === '{' || ch === '}')) {
      // `?? 0` is unreachable — this branch is guarded by `length > 0` — but
      // it is what lets the compiler see that, and it reads the same as the
      // depth an empty stack would imply.
      const depth = interpolations.at(-1) ?? 0;
      if (ch === '{') {
        interpolations[interpolations.length - 1] = depth + 1;
      } else if (depth > 0) {
        interpolations[interpolations.length - 1] = depth - 1;
      } else {
        // Depth 0: this `}` really does close the interpolation, so what
        // follows is template text again.
        interpolations.pop();
        i = skipTemplateText(i + 1);
        if (code[i] === '`') {
          i++;
          lastSignificant = '`';
        } else {
          interpolations.push(0);
          i += 2;
          lastSignificant = '{';
        }
        continue;
      }
      lastSignificant = ch;
      i++;
      continue;
    }
    if (ch === '/' && code[i + 1] === '*') {
      const start = i;
      i = code.indexOf('*/', i + 2);
      i = i === -1 ? code.length : i + 2;
      blank(start, i);
      continue;
    }
    if (ch === '/' && code[i + 1] === '/') {
      const start = i;
      const nl = code.indexOf('\n', i);
      i = nl === -1 ? code.length : nl;
      blank(start, i);
      continue;
    }
    if (ch === '/' && regexAllowedAfter.test(lastSignificant)) {
      const start = i++;
      let inClass = false;
      while (i < code.length) {
        if (code[i] === '\\') {
          i += 2;
        } else if (code[i] === '[') {
          inClass = true;
          i++;
        } else if (code[i] === ']') {
          inClass = false;
          i++;
        } else if (code[i] === '\n' || (code[i] === '/' && !inClass)) {
          break;
        } else {
          i++;
        }
      }
      blank(start + 1, i);
      i++;
      lastSignificant = '/';
      continue;
    }
    if (!/\s/.test(ch)) lastSignificant = ch;
    i++;
  }
  return out.join('');
}

function findFree(code: string, masked: string, name: string) {
  // A free call: the name is called, and the character before it cannot be part
  // of a longer identifier or a property access (`x.ref(`, `deref(`, `a?.ref(`).
  // No whitespace before the `(` — generated code never emits `ref (`, while
  // prose routinely does.
  const re = new RegExp(`(^|[^A-Za-z0-9_$.])${name}\\(`, 'g');
  const hits = [];
  for (const match of masked.matchAll(re)) {
    const openParen = match.index + match[0].length - 1;
    // `get ref(){}` / `set ref(){}` / `async ref(){}` are definitions too.
    const before = masked.slice(Math.max(0, match.index - 12), match.index + 1);
    if (/\b(?:get|set|async)\s*$/.test(before)) continue;
    if (isDefinition(masked, openParen)) continue;
    hits.push({
      index: match.index,
      context: code.slice(
        Math.max(0, match.index - 60),
        Math.min(code.length, match.index + 60)
      )
    });
  }
  return hits;
}

let files;
try {
  files = jsFiles(bundleDir);
} catch {
  console.error(
    `check-bundle-globals: no bundle at ${bundleDir} — build it first ` +
      `(pnpm generate, or pnpm tauri build).`
  );
  process.exit(1);
}

if (files.length === 0) {
  console.error(
    `check-bundle-globals: ${bundleDir} holds no JavaScript — refusing to ` +
      `report a pass on a bundle that is not there.`
  );
  process.exit(1);
}

const findings = [];
for (const file of files) {
  const code = readFileSync(file, 'utf8');
  const masked = maskNonCode(code);
  for (const name of WATCHED) {
    if (isBound(masked, name)) continue;
    for (const hit of findFree(code, masked, name)) {
      findings.push({ file: relative(process.cwd(), file), name, ...hit });
    }
  }
}

if (findings.length > 0) {
  console.error(
    `check-bundle-globals: ${findings.length} free Vue-API reference(s) in ` +
      `the built bundle. Each one throws "<name> is not defined" the moment ` +
      `its component renders.\n`
  );
  for (const finding of findings) {
    console.error(`  ${finding.file}  —  ${finding.name}()`);
    console.error(`    …${finding.context.replaceAll('\n', ' ')}…\n`);
  }
  console.error(
    'Usually the SFC binds that name itself — a `v-for` alias or a parameter ' +
      'called `ref` — so Nuxt skipped the auto-import. Rename the binding.'
  );
  process.exit(1);
}

console.log(
  `check-bundle-globals: ${files.length} chunk(s) scanned, no free Vue-API ` +
    `references.`
);
