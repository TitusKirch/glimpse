<script setup lang="ts">
// Renders the shared single-field prompt (see usePrompt) as a TanStack Form.
// Mounted once in app.vue.
const { request, answer } = usePrompt();
const { t } = useI18n();

const open = computed({
  get: () => !!request.value,
  set: (v: boolean) => {
    if (!v) answer(null);
  }
});
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
      <PromptForm
        :key="request.id"
        :label-key="request.labelKey"
        :description-key="request.descriptionKey"
        :placeholder-key="request.placeholderKey"
        :submit-key="request.submitKey"
        :initial="request.initial"
        :schema="request.schema"
        @submit="answer($event)"
        @cancel="answer(null)"
      />
    </UiDialogContent>
  </UiDialog>
</template>
