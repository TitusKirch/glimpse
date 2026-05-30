<script setup lang="ts">
// Lightweight unified/split diff renderer driven by git unified-diff hunks.
// Rows fill the full scroll width (so highlights span it), line-number gutters
// are sticky-left, and code is syntax-highlighted via highlight.js.
import hljs from 'highlight.js';

const props = defineProps<{
  hunks: string[];
  mode: 'split' | 'unified';
  fileName: string;
}>();

type RowType = 'hunk' | 'context' | 'add' | 'del';

interface URow {
  type: RowType;
  oldNo?: number;
  newNo?: number;
  html: string;
}

type CellType = 'context' | 'add' | 'del' | 'empty';
interface SCell {
  no?: number;
  html: string;
  type: CellType;
}
interface SRow {
  hunk?: string;
  left?: SCell;
  right?: SCell;
}

const LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  vue: 'xml',
  html: 'xml',
  xml: 'xml',
  svg: 'xml',
  json: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  rs: 'rust',
  go: 'go',
  py: 'python',
  rb: 'ruby',
  php: 'php',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  md: 'markdown',
  sql: 'sql',
  lua: 'lua'
};

const lang = computed(() => {
  const ext = props.fileName.split('.').pop()?.toLowerCase() ?? '';
  const name = LANG[ext];
  return name && hljs.getLanguage(name) ? name : '';
});

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c
  );
}

function hl(text: string): string {
  if (!text) return '';
  if (!lang.value) return escapeHtml(text);
  try {
    return hljs.highlight(text, { language: lang.value, ignoreIllegals: true })
      .value;
  } catch {
    return escapeHtml(text);
  }
}

const unified = computed<URow[]>(() => {
  const out: URow[] = [];
  for (const hunk of props.hunks) {
    const lines = hunk.split('\n');
    const header = lines[0] ?? '';
    const m = header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    let oldNo = m ? Number(m[1]) : 1;
    let newNo = m ? Number(m[2]) : 1;
    out.push({ type: 'hunk', html: escapeHtml(header) });
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i] ?? '';
      const c = l[0];
      const html = hl(l.slice(1));
      if (c === '\\') continue;
      if (c === '+') out.push({ type: 'add', newNo: newNo++, html });
      else if (c === '-') out.push({ type: 'del', oldNo: oldNo++, html });
      else out.push({ type: 'context', oldNo: oldNo++, newNo: newNo++, html });
    }
  }
  return out;
});

const split = computed<SRow[]>(() => {
  const out: SRow[] = [];
  let dels: URow[] = [];
  let adds: URow[] = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) {
      const d = dels[i];
      const a = adds[i];
      out.push({
        left: d
          ? { no: d.oldNo, html: d.html, type: 'del' }
          : { html: '', type: 'empty' },
        right: a
          ? { no: a.newNo, html: a.html, type: 'add' }
          : { html: '', type: 'empty' }
      });
    }
    dels = [];
    adds = [];
  };
  for (const r of unified.value) {
    if (r.type === 'del') dels.push(r);
    else if (r.type === 'add') adds.push(r);
    else {
      flush();
      if (r.type === 'hunk') out.push({ hunk: r.html });
      else
        out.push({
          left: { no: r.oldNo, html: r.html, type: 'context' },
          right: { no: r.newNo, html: r.html, type: 'context' }
        });
    }
  }
  flush();
  return out;
});

const rowBg: Record<string, string> = {
  add: 'bg-green-500/15',
  del: 'bg-red-500/15',
  context: '',
  empty: 'bg-muted/40'
};

// Keep the two split panes vertically in sync.
const leftPane = ref<HTMLElement | null>(null);
const rightPane = ref<HTMLElement | null>(null);
let lock = false;
function sync(src: 'l' | 'r') {
  if (lock) return;
  const from = src === 'l' ? leftPane.value : rightPane.value;
  const to = src === 'l' ? rightPane.value : leftPane.value;
  if (!from || !to) return;
  lock = true;
  to.scrollTop = from.scrollTop;
  requestAnimationFrame(() => {
    lock = false;
  });
}

const gutter =
  'sticky z-10 shrink-0 bg-background px-2 text-right text-muted-foreground select-none';
</script>

<template>
  <!-- unified -->
  <div
    v-if="mode === 'unified'"
    class="hljs-diff h-full overflow-auto font-mono text-xs leading-[1.6]"
  >
    <div class="w-max min-w-full">
      <div
        v-for="(r, i) in unified"
        :key="i"
        class="flex"
        :class="rowBg[r.type]"
      >
        <span
          v-if="r.type === 'hunk'"
          class="sticky left-0 bg-accent px-2 whitespace-pre text-muted-foreground"
          v-html="r.html"
        />
        <template v-else>
          <span :class="[gutter, 'left-0 w-12']">{{ r.oldNo ?? '' }}</span>
          <span :class="[gutter, 'left-12 w-12']">{{ r.newNo ?? '' }}</span>
          <span
            class="sticky left-24 z-10 w-4 shrink-0 bg-background text-center text-muted-foreground select-none"
            >{{ r.type === 'add' ? '+' : r.type === 'del' ? '-' : '' }}</span
          >
          <span class="grow px-1 whitespace-pre" v-html="r.html" />
        </template>
      </div>
    </div>
  </div>

  <!-- split: two resizable panes, each scrolls its own code; vertical synced -->
  <UiResizablePanelGroup
    v-else
    direction="horizontal"
    class="hljs-diff h-full font-mono text-xs leading-[1.6]"
  >
    <UiResizablePanel :default-size="50" :min-size="15">
      <div
        ref="leftPane"
        class="diff-no-vscroll h-full overflow-auto"
        @scroll="sync('l')"
      >
        <div class="w-max min-w-full">
          <div
            v-for="(r, i) in split"
            :key="i"
            class="flex"
            :class="r.left ? rowBg[r.left.type] : ''"
          >
            <span
              v-if="r.hunk !== undefined"
              class="sticky left-0 bg-accent px-2 whitespace-pre text-muted-foreground"
              v-html="r.hunk"
            />
            <template v-else>
              <span :class="[gutter, 'left-0 w-12']">{{
                r.left!.no ?? ''
              }}</span>
              <span class="grow px-1 whitespace-pre" v-html="r.left!.html" />
            </template>
          </div>
        </div>
      </div>
    </UiResizablePanel>
    <UiResizableHandle class="z-20" />
    <UiResizablePanel :default-size="50" :min-size="15">
      <div ref="rightPane" class="h-full overflow-auto" @scroll="sync('r')">
        <div class="w-max min-w-full">
          <div
            v-for="(r, i) in split"
            :key="i"
            class="flex"
            :class="r.right ? rowBg[r.right.type] : ''"
          >
            <span
              v-if="r.hunk !== undefined"
              class="sticky left-0 bg-accent px-2 whitespace-pre text-muted-foreground"
              v-html="r.hunk"
            />
            <template v-else>
              <span :class="[gutter, 'left-0 w-12']">{{
                r.right!.no ?? ''
              }}</span>
              <span class="grow px-1 whitespace-pre" v-html="r.right!.html" />
            </template>
          </div>
        </div>
      </div>
    </UiResizablePanel>
  </UiResizablePanelGroup>
</template>
