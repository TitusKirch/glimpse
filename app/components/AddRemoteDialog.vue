<script setup lang="ts">
// Add-remote dialog (name + url). Mounted once in app.vue.
const { open } = useRemoteDialog();
const repo = useRepoStore();
const { t } = useI18n();

const name = ref('');
const url = ref('');

watch(open, (isOpen) => {
  if (isOpen) {
    name.value = '';
    url.value = '';
  }
});

const valid = computed(() => !!name.value.trim() && !!url.value.trim());

async function submit() {
  if (!valid.value) return;
  await repo.addRemote(name.value.trim(), url.value.trim());
  open.value = false;
}
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent class="max-w-sm">
      <UiDialogHeader>
        <UiDialogTitle>{{ t('sidebar.addRemote') }}</UiDialogTitle>
        <UiDialogDescription class="sr-only">
          {{ t('sidebar.addRemote') }}
        </UiDialogDescription>
      </UiDialogHeader>
      <div class="space-y-2">
        <UiInput
          v-model="name"
          :placeholder="t('sidebar.remoteName')"
          autofocus
        />
        <UiInput
          v-model="url"
          :placeholder="t('sidebar.remoteUrl')"
          @keydown.enter="submit"
        />
      </div>
      <div class="flex justify-end gap-2">
        <UiButton variant="outline" @click="open = false">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton :disabled="!valid" @click="submit">
          {{ t('sidebar.addRemote') }}
        </UiButton>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
