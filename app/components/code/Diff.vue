<script setup lang="ts">
// Lightweight unified/split diff renderer driven by git unified-diff hunks.
// Rows fill the full scroll width (so highlights span it), line-number gutters
// are sticky-left, and code is syntax-highlighted via highlight.js. In split
// mode, paired -/+ lines additionally get word-level highlighting. When a hunk
// action is enabled, each hunk header carries a stage/unstage button.
//
// Rows are virtualized (TanStack Virtual) so a 10k-line file only mounts the
// handful of rows on screen. We use the *padding* technique — real rows stay in
// normal flow between a top/bottom spacer — rather than absolute positioning,
// because absolute rows can't push a `w-max` track wider than the viewport and
// would kill horizontal scrolling of long lines. Heights are measured per row
// (measureElement), so the estimate only needs to be roughly right.
import hljs from 'highlight.js';
import { useVirtualizer } from '@tanstack/vue-virtual';
import { highlightLines } from '@/utils/highlight';

const props = defineProps<{
  hunks: string[];
  mode: 'split' | 'unified';
  fileName: string;
  // When set, each hunk gets a stage/unstage button emitting `stageHunk`.
  hunkAction?: 'stage' | 'unstage' | null;
  // Whole-file view: drop the `@@` hunk-header rows (the diff was fetched with
  // full context, so there's a single header — hiding it reads as "the file").
  hideHunkHeader?: boolean;
  // Full file contents (from DiffData). When present, lines are highlighted from
  // the whole file (keeping cross-line context, e.g. a Vue SFC's script/style)
  // and looked up by line number, instead of highlighted in isolation.
  oldContent?: string;
  newContent?: string;
}>();

const emit = defineEmits<{ stageHunk: [hunk: string] }>();

type RowType = 'hunk' | 'context' | 'add' | 'del';

interface URow {
  type: RowType;
  oldNo?: number;
  newNo?: number;
  html: string;
  // Raw line text (for word-level diffing); undefined for hunk headers.
  text?: string;
  // Index into props.hunks for hunk-header rows.
  hunkIndex?: number;
}

type CellType = 'context' | 'add' | 'del' | 'empty';
interface SCell {
  no?: number;
  html: string;
  type: CellType;
}
interface SRow {
  hunk?: string;
  hunkIndex?: number;
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

// Whole-file highlight, one entry per line (index = line number - 1). Computed
// once per diff; falls back per-line via hl() when a line isn't found.
const oldHi = computed(() =>
  highlightLines({ text: props.oldContent ?? '', lang: lang.value })
);
const newHi = computed(() =>
  highlightLines({ text: props.newContent ?? '', lang: lang.value })
);
function hlOld({ no, text }: { no: number; text: string }): string {
  return oldHi.value[no - 1] ?? hl(text);
}
function hlNew({ no, text }: { no: number; text: string }): string {
  return newHi.value[no - 1] ?? hl(text);
}

// Word-level diff of a removed/added line pair: highlight the changed middle
// (common prefix/suffix trimmed by the pure wordDiffRanges helper). Cheap and
// effective for the common single-edit line.
function wordDiff({ a, b }: { a: string; b: string }): {
  oldHtml: string;
  newHtml: string;
} {
  const { start, aEnd, bEnd } = wordDiffRanges({ a, b });
  const wrap = (s: string, cls: string) =>
    s ? `<span class="${cls}">${escapeHtml(s)}</span>` : '';
  return {
    oldHtml:
      escapeHtml(a.slice(0, start)) +
      wrap(a.slice(start, aEnd), 'wd-del') +
      escapeHtml(a.slice(aEnd)),
    newHtml:
      escapeHtml(b.slice(0, start)) +
      wrap(b.slice(start, bEnd), 'wd-add') +
      escapeHtml(b.slice(bEnd))
  };
}

const unified = computed<URow[]>(() => {
  const out: URow[] = [];
  props.hunks.forEach((hunk, hunkIndex) => {
    const lines = hunk.split('\n');
    const header = lines[0] ?? '';
    const m = header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    let oldNo = m ? Number(m[1]) : 1;
    let newNo = m ? Number(m[2]) : 1;
    out.push({ type: 'hunk', html: escapeHtml(header), hunkIndex });

    // Buffer consecutive removals/additions so a modified line (a -/+ pair) can
    // be word-diffed — the changed substring gets emphasised like in split mode.
    let dels: { text: string; oldNo: number }[] = [];
    let adds: { text: string; newNo: number }[] = [];
    const flush = () => {
      const n = Math.max(dels.length, adds.length);
      const delHtml: string[] = [];
      const addHtml: string[] = [];
      for (let i = 0; i < n; i++) {
        const d = dels[i];
        const a = adds[i];
        if (d && a) {
          const wd = wordDiff({ a: d.text, b: a.text });
          delHtml.push(wd.oldHtml);
          addHtml.push(wd.newHtml);
        } else if (d) delHtml.push(hlOld({ no: d.oldNo, text: d.text }));
        else if (a) addHtml.push(hlNew({ no: a.newNo, text: a.text }));
      }
      dels.forEach((d, i) =>
        out.push({
          type: 'del',
          oldNo: d.oldNo,
          html: delHtml[i]!,
          text: d.text
        })
      );
      adds.forEach((a, i) =>
        out.push({
          type: 'add',
          newNo: a.newNo,
          html: addHtml[i]!,
          text: a.text
        })
      );
      dels = [];
      adds = [];
    };

    for (let i = 1; i < lines.length; i++) {
      const l = lines[i] ?? '';
      const c = l[0];
      const text = l.slice(1);
      if (c === '\\') continue;
      if (c === '+') adds.push({ text, newNo: newNo++ });
      else if (c === '-') dels.push({ text, oldNo: oldNo++ });
      else {
        flush();
        const o = oldNo++;
        const nn = newNo++;
        out.push({
          type: 'context',
          oldNo: o,
          newNo: nn,
          html: hlNew({ no: nn, text }),
          text
        });
      }
    }
    flush();
  });
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
      // When a line was both removed and re-added, word-diff the pair.
      let leftHtml = d?.html ?? '';
      let rightHtml = a?.html ?? '';
      if (d && a && d.text !== undefined && a.text !== undefined) {
        const wd = wordDiff({ a: d.text, b: a.text });
        leftHtml = wd.oldHtml;
        rightHtml = wd.newHtml;
      }
      out.push({
        left: d
          ? { no: d.oldNo, html: leftHtml, type: 'del' }
          : { html: '', type: 'empty' },
        right: a
          ? { no: a.newNo, html: rightHtml, type: 'add' }
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
      if (r.type === 'hunk') out.push({ hunk: r.html, hunkIndex: r.hunkIndex });
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

// --- Virtualization ---------------------------------------------------------
// Every row is a single line pinned to an exact 20px box (`h-5 leading-5`), so
// we use a fixed size and skip per-row measurement. Measuring would re-round the
// 12px×1.6 line box to 19/20px frame-by-frame while scrolling, nudging paddingTop
// and making the row backgrounds flicker — a fixed height keeps it rock steady.
const ROW_H = 20;

// Only the active mode feeds rows to its virtualizer (the hidden one stays at
// count 0 and does no work).
const unifiedRows = computed(() => {
  if (props.mode !== 'unified') return [];
  return props.hideHunkHeader
    ? unified.value.filter((r) => r.type !== 'hunk')
    : unified.value;
});
const splitRows = computed(() => (props.mode === 'split' ? split.value : []));

const unifiedScroll = ref<HTMLElement | null>(null);

function makeVirtualizer({
  count,
  getEl
}: {
  count: Ref<number>;
  getEl: () => HTMLElement | null;
}) {
  const virt = useVirtualizer(
    computed(() => ({
      count: count.value,
      getScrollElement: getEl,
      estimateSize: () => ROW_H,
      overscan: 24
    }))
  );
  const items = computed(() => virt.value.getVirtualItems());
  const padTop = computed(() => items.value[0]?.start ?? 0);
  const padBottom = computed(() => {
    const last = items.value[items.value.length - 1];
    return last ? virt.value.getTotalSize() - last.end : 0;
  });
  return reactive({ items, padTop, padBottom });
}

const unifiedCount = computed(() => unifiedRows.value.length);
const splitCount = computed(() => splitRows.value.length);

const uv = makeVirtualizer({
  count: unifiedCount,
  getEl: () => unifiedScroll.value
});
const lv = makeVirtualizer({ count: splitCount, getEl: () => leftPane.value });
const rv = makeVirtualizer({ count: splitCount, getEl: () => rightPane.value });

// Pair each on-screen virtual item with its row data for the template.
const uVisible = computed(() =>
  uv.items.map((vi) => ({ vi, row: unified.value[vi.index]! }))
);
const lVisible = computed(() =>
  lv.items.map((vi) => ({ vi, row: split.value[vi.index]! }))
);
const rVisible = computed(() =>
  rv.items.map((vi) => ({ vi, row: split.value[vi.index]! }))
);
</script>

<template>
  <!-- unified -->
  <div
    v-if="mode === 'unified'"
    ref="unifiedScroll"
    class="hljs-diff h-full overflow-auto font-mono text-xs leading-[1.6]"
  >
    <div
      class="w-max min-w-full"
      :style="{
        paddingTop: `${uv.padTop}px`,
        paddingBottom: `${uv.padBottom}px`
      }"
    >
      <div
        v-for="{ vi, row } in uVisible"
        :key="vi.key"
        class="flex h-5 leading-5"
      >
        <div
          v-if="row.type === 'hunk'"
          class="sticky left-0 flex w-full items-center bg-accent"
        >
          <span
            class="px-2 whitespace-pre text-muted-foreground"
            v-html="row.html"
          />
          <button
            v-if="hunkAction"
            class="ml-auto cursor-pointer px-2 text-[10px] font-medium text-muted-foreground hover:text-foreground"
            @click="emit('stageHunk', hunks[row.hunkIndex!]!)"
          >
            {{ hunkAction === 'stage' ? '+ stage' : '− unstage' }}
          </button>
        </div>
        <template v-else>
          <span :class="[gutter, 'left-0 w-12']">{{ row.oldNo ?? '' }}</span>
          <span :class="[gutter, 'left-12 w-12']">{{ row.newNo ?? '' }}</span>
          <span
            class="sticky left-24 z-10 w-4 shrink-0 bg-background text-center text-muted-foreground select-none"
            >{{
              row.type === 'add' ? '+' : row.type === 'del' ? '-' : ''
            }}</span
          >
          <span
            class="grow px-1 whitespace-pre"
            :class="rowBg[row.type]"
            v-html="row.html"
          />
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
        <div
          class="w-max min-w-full"
          :style="{
            paddingTop: `${lv.padTop}px`,
            paddingBottom: `${lv.padBottom}px`
          }"
        >
          <div
            v-for="{ vi, row: r } in lVisible"
            :key="vi.key"
            class="flex h-5 leading-5"
          >
            <div
              v-if="r.hunk !== undefined"
              class="sticky left-0 flex w-full items-center bg-accent"
            >
              <span
                class="px-2 whitespace-pre text-muted-foreground"
                v-html="r.hunk"
              />
              <button
                v-if="hunkAction"
                class="ml-auto cursor-pointer px-2 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                @click="emit('stageHunk', hunks[r.hunkIndex!]!)"
              >
                {{ hunkAction === 'stage' ? '+ stage' : '− unstage' }}
              </button>
            </div>
            <template v-else>
              <span :class="[gutter, 'left-0 w-12']">{{
                r.left!.no ?? ''
              }}</span>
              <span
                class="grow px-1 whitespace-pre"
                :class="rowBg[r.left!.type]"
                v-html="r.left!.html"
              />
            </template>
          </div>
        </div>
      </div>
    </UiResizablePanel>
    <UiResizableHandle class="z-20" />
    <UiResizablePanel :default-size="50" :min-size="15">
      <div ref="rightPane" class="h-full overflow-auto" @scroll="sync('r')">
        <div
          class="w-max min-w-full"
          :style="{
            paddingTop: `${rv.padTop}px`,
            paddingBottom: `${rv.padBottom}px`
          }"
        >
          <div
            v-for="{ vi, row: r } in rVisible"
            :key="vi.key"
            class="flex h-5 leading-5"
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
              <span
                class="grow px-1 whitespace-pre"
                :class="rowBg[r.right!.type]"
                v-html="r.right!.html"
              />
            </template>
          </div>
        </div>
      </div>
    </UiResizablePanel>
  </UiResizablePanelGroup>
</template>
