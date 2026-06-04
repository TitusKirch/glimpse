<script setup lang="ts">
// Friendly view for a Git LFS-tracked file. The backend ships the small text
// pointer (version / oid / size) as the diff hunks rather than the smudged
// binary, so we summarise the object — size change and short oid — instead of
// rendering pointer lines as if they were source.
const props = defineProps<{ hunks: string[] }>();

const { t } = useI18n();

// Pull a pointer field (e.g. `size`, `oid`) from the hunks, keeping the old
// (`-`) and current (`+`/context) sides apart.
function field(prefix: string): { old?: string; cur?: string } {
  const res: { old?: string; cur?: string } = {};
  for (const hunk of props.hunks) {
    for (const line of hunk.split('\n')) {
      const marker = line[0];
      const body = line.slice(1).trim();
      if (!body.startsWith(prefix)) continue;
      const value = body.slice(prefix.length).trim();
      if (marker === '-') res.old = value;
      else if (marker === '+') res.cur = value;
      else if (marker === ' ') {
        res.old ??= value;
        res.cur ??= value;
      }
    }
  }
  return res;
}

function humanSize(bytes?: string): string {
  const n = Number(bytes);
  if (!bytes || Number.isNaN(n)) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${u === 0 ? v : v.toFixed(1)} ${units[u]}`;
}

const size = computed(() => field('size'));
const oid = computed(() => {
  const shorten = (s?: string) => s?.replace(/^sha256:/, '').slice(0, 12);
  const o = field('oid');
  return { old: shorten(o.old), cur: shorten(o.cur) };
});
const sizeChanged = computed(
  () =>
    !!size.value.old && !!size.value.cur && size.value.old !== size.value.cur
);
</script>

<template>
  <div
    class="flex h-full flex-col items-center justify-center gap-4 p-8 text-center"
  >
    <NuxtIcon name="lucide:database" class="size-10 text-muted-foreground" />
    <div class="space-y-1">
      <p class="text-sm font-medium">{{ t('diff.lfs') }}</p>
      <p class="mx-auto max-w-sm text-xs text-muted-foreground">
        {{ t('diff.lfsNote') }}
      </p>
    </div>
    <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-left text-xs">
      <template v-if="size.cur || size.old">
        <dt class="text-muted-foreground">{{ t('diff.lfsSize') }}</dt>
        <dd class="font-mono">
          <template v-if="sizeChanged"
            >{{ humanSize(size.old) }} → {{ humanSize(size.cur) }}</template
          >
          <template v-else>{{ humanSize(size.cur ?? size.old) }}</template>
        </dd>
      </template>
      <template v-if="oid.cur || oid.old">
        <dt class="text-muted-foreground">{{ t('diff.lfsOid') }}</dt>
        <dd class="font-mono">{{ oid.cur ?? oid.old }}</dd>
      </template>
    </dl>
  </div>
</template>
