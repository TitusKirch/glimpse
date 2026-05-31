<script setup lang="ts">
// Renders the shared confirm request (see useConfirm). Mounted once in app.vue.
const { request, answer } = useConfirm();
const { t } = useI18n();

const open = computed({
  get: () => !!request.value,
  set: (v: boolean) => {
    if (!v) answer(false);
  }
});
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent v-if="request" class="max-w-sm">
      <UiDialogHeader>
        <UiDialogTitle>{{ t(request.titleKey) }}</UiDialogTitle>
        <UiDialogDescription>{{
          t(request.descriptionKey)
        }}</UiDialogDescription>
      </UiDialogHeader>
      <div class="flex justify-end gap-2">
        <UiButton variant="outline" @click="answer(false)">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton @click="answer(true)">{{ t(request.confirmKey) }}</UiButton>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
