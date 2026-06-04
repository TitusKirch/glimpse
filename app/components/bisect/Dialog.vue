<script setup lang="ts">
// Start a guided bisect: pick a known-bad and known-good ref. Once started, the
// changes panel shows a banner to mark each step good/bad/skip. Mounted in app.vue.
const { open } = useOverlay('bisect');
const repo = useRepoStore();
const { t } = useI18n();

const bad = ref('');
const good = ref('');

const refs = computed(() => [
  ...repo.branches.map((b) => b.name),
  ...repo.remoteBranches,
  ...repo.tags
]);

watch(open, (isOpen) => {
  if (isOpen) {
    bad.value = repo.currentBranch;
    good.value = '';
  }
});

const canStart = computed(
  () => !!bad.value && !!good.value && bad.value !== good.value
);

async function start() {
  if (!canStart.value) return;
  await repo.bisectStart({ bad: bad.value, good: good.value });
  open.value = false;
}
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent class="max-w-sm">
      <UiDialogHeader>
        <UiDialogTitle>{{ t('bisect.title') }}</UiDialogTitle>
        <UiDialogDescription>{{ t('bisect.description') }}</UiDialogDescription>
      </UiDialogHeader>

      <div class="space-y-3">
        <div>
          <p class="mb-1 text-xs font-medium text-muted-foreground">
            {{ t('bisect.bad') }}
          </p>
          <UiSelect
            :model-value="bad"
            @update:model-value="(v) => (bad = v as string)"
          >
            <UiSelectTrigger class="w-full">
              <UiSelectValue :placeholder="t('bisect.bad')" />
            </UiSelectTrigger>
            <UiSelectContent>
              <UiSelectItem v-for="r in refs" :key="`b-${r}`" :value="r">
                {{ r }}
              </UiSelectItem>
            </UiSelectContent>
          </UiSelect>
        </div>
        <div>
          <p class="mb-1 text-xs font-medium text-muted-foreground">
            {{ t('bisect.good') }}
          </p>
          <UiSelect
            :model-value="good"
            @update:model-value="(v) => (good = v as string)"
          >
            <UiSelectTrigger class="w-full">
              <UiSelectValue :placeholder="t('bisect.good')" />
            </UiSelectTrigger>
            <UiSelectContent>
              <UiSelectItem v-for="r in refs" :key="`g-${r}`" :value="r">
                {{ r }}
              </UiSelectItem>
            </UiSelectContent>
          </UiSelect>
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <UiButton variant="outline" @click="open = false">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton :disabled="!canStart" @click="start">
          {{ t('bisect.start') }}
        </UiButton>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
