<script setup lang="ts">
// Stash dialog: an optional message plus a checklist of changed files, so you
// can stash everything or only selected paths. Untracked files are listed too
// and pull in `-u` automatically when selected. Mounted once in app.vue.
const { open } = useOverlay('stash');
const repo = useRepoStore();
const { t } = useI18n();

const message = ref('');
const selected = ref<Set<string>>(new Set());

// All non-conflicted changes, deduped by path (a file can be both staged and
// unstaged); the untracked flag is kept so selecting one enables `-u`.
const files = computed(() => {
  const seen = new Map<string, { path: string; untracked: boolean }>();
  for (const e of repo.status) {
    if (e.conflicted) continue;
    const prev = seen.get(e.path)?.untracked ?? false;
    seen.set(e.path, { path: e.path, untracked: prev || e.untracked });
  }
  return [...seen.values()];
});

watch(open, (isOpen) => {
  if (isOpen) {
    message.value = '';
    selected.value = new Set(files.value.map((f) => f.path));
  }
});

function toggle(path: string) {
  const next = new Set(selected.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  selected.value = next;
}

const canStash = computed(() => selected.value.size > 0);

async function submit() {
  if (!canStash.value) return;
  const chosen = [...selected.value];
  const allSelected = chosen.length === files.value.length;
  const anyUntracked = files.value.some(
    (f) => f.untracked && selected.value.has(f.path)
  );
  await repo.stashSave({
    message: message.value.trim(),
    includeUntracked: anyUntracked,
    paths: allSelected ? [] : chosen
  });
  open.value = false;
}
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent class="max-w-md">
      <UiDialogHeader>
        <UiDialogTitle>{{ t('stash.title') }}</UiDialogTitle>
        <UiDialogDescription class="sr-only">
          {{ t('stash.title') }}
        </UiDialogDescription>
      </UiDialogHeader>

      <UiInput
        :model-value="message"
        :placeholder="t('stash.messagePlaceholder')"
        autofocus
        @input="message = ($event.target as HTMLInputElement).value"
      />

      <div v-if="files.length" class="min-w-0">
        <p
          class="mb-1 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {{ t('stash.files') }}
        </p>
        <ul class="max-h-64 space-y-0.5 overflow-auto">
          <li v-for="f in files" :key="f.path">
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
              @click="toggle(f.path)"
            >
              <NuxtIcon
                :name="
                  selected.has(f.path) ? 'lucide:square-check' : 'lucide:square'
                "
                class="size-4 shrink-0"
                :class="
                  selected.has(f.path)
                    ? 'text-primary'
                    : 'text-muted-foreground'
                "
              />
              <span class="min-w-0 flex-1 truncate font-mono text-xs">{{
                f.path
              }}</span>
              <UiBadge v-if="f.untracked" variant="secondary" size="sm">
                {{ t('stash.untracked') }}
              </UiBadge>
            </button>
          </li>
        </ul>
      </div>
      <p v-else class="text-sm text-muted-foreground">
        {{ t('stash.nothing') }}
      </p>

      <div class="flex justify-end gap-2">
        <UiButton variant="outline" type="button" @click="open = false">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton type="button" :disabled="!canStash" @click="submit">
          {{ t('stash.submit') }}
        </UiButton>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
