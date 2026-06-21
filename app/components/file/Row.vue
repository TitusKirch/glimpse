<script setup lang="ts">
// A single file entry, shared by the Changes panel and the commit file list.
const props = defineProps<{
  path: string;
  status: string;
  active?: boolean;
  // Tree mode: show only the basename (the folder is the row above) and
  // indent by depth.
  nameOnly?: boolean;
  depth?: number;
  // Tracked by Git LFS — shows an "LFS" badge so a pointer change reads as a
  // binary object, not a tiny text edit.
  isLfs?: boolean;
  // Opt-in multi-select (changelist panel only): show a leading checkbox and
  // emit `toggle` when it's clicked. Off everywhere else, so the shared diff
  // file list is unaffected. `selected` reflects the checkbox state.
  selectable?: boolean;
  selected?: boolean;
}>();

defineEmits<{ select: []; toggle: [] }>();

const { t } = useI18n();

// 0.75rem per level, plus room to align with a folder's chevron.
const indentStyle = computed(() => ({
  paddingLeft: `${0.5 + (props.depth ?? 0) * 0.75 + (props.nameOnly ? 1.25 : 0)}rem`
}));

const COLOR: Record<string, string> = {
  A: 'text-green-500',
  M: 'text-amber-500',
  D: 'text-red-500',
  R: 'text-purple-500',
  C: 'text-purple-500'
};

const name = computed(() => {
  const i = props.path.lastIndexOf('/');
  return i >= 0 ? props.path.slice(i + 1) : props.path;
});
const dir = computed(() => {
  const i = props.path.lastIndexOf('/');
  return i >= 0 ? props.path.slice(0, i) : '';
});
</script>

<template>
  <div
    role="button"
    tabindex="0"
    class="group flex w-full select-none items-center gap-2 rounded-md py-1 pr-2 text-left transition-colors hover:bg-accent/60"
    :class="active && 'bg-accent'"
    :style="indentStyle"
    :title="path"
    @click="$emit('select')"
    @keydown.enter="$emit('select')"
  >
    <button
      v-if="selectable"
      type="button"
      class="flex size-4 shrink-0 cursor-pointer items-center justify-center"
      :class="selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
      :aria-label="t('changes.select')"
      @click.stop="$emit('toggle')"
      @keydown.enter.stop="$emit('toggle')"
    >
      <NuxtIcon
        :name="selected ? 'lucide:square-check' : 'lucide:square'"
        class="size-4"
        :class="selected ? 'text-primary' : 'text-muted-foreground'"
      />
    </button>
    <span
      class="flex w-4 shrink-0 items-center justify-center font-mono text-[11px] font-bold"
      :class="COLOR[status] ?? 'text-muted-foreground'"
      >{{ status }}</span
    >
    <span class="flex min-w-0 flex-1 items-baseline gap-1.5 truncate">
      <span>{{ name }}</span>
      <span
        v-if="dir && !nameOnly"
        class="truncate text-xs text-muted-foreground"
        >{{ dir }}</span
      >
    </span>
    <span
      v-if="isLfs"
      class="shrink-0 rounded bg-blue-500/15 px-1 text-[9px] font-semibold tracking-wide text-blue-600 dark:text-blue-400"
      :title="t('changes.lfs')"
      >LFS</span
    >
    <span class="flex shrink-0 items-center gap-0.5">
      <slot name="actions" />
    </span>
  </div>
</template>
