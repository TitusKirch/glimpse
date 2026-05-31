<script setup lang="ts">
// Renders the shared text-input prompt (see usePrompt). Mounted once in app.vue.
const { request, answer } = usePrompt();
const { t } = useI18n();

const value = ref('');

// Seed the field whenever a new prompt opens.
watch(request, (r) => {
  value.value = r?.initial ?? '';
});

const open = computed({
  get: () => !!request.value,
  set: (v: boolean) => {
    if (!v) answer(null);
  }
});

function submit() {
  const v = value.value.trim();
  answer(v || null);
}
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent v-if="request" class="max-w-sm">
      <UiDialogHeader>
        <UiDialogTitle>{{ t(request.titleKey) }}</UiDialogTitle>
        <UiDialogDescription class="sr-only">
          {{ t(request.titleKey) }}
        </UiDialogDescription>
      </UiDialogHeader>
      <UiInput
        v-model="value"
        :placeholder="t(request.placeholderKey)"
        autofocus
        @keydown.enter="submit"
      />
      <div class="flex justify-end gap-2">
        <UiButton variant="outline" @click="answer(null)">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton :disabled="!value.trim()" @click="submit">
          {{ t(request.confirmKey) }}
        </UiButton>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
