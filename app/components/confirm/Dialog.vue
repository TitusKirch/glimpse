<script setup lang="ts">
// Renders the shared confirm request (see useConfirm). Mounted once in app.vue.
// When the request carries an async `action`, the dialog runs it inline — the
// confirm button shows a spinner, cancel/close are blocked — and only closes
// once it settles. Without an action it resolves immediately, as before.
const { request, answer } = useConfirm();
const { t } = useI18n();

const pending = ref(false);

const open = computed({
  get: () => !!request.value,
  set: (v: boolean) => {
    // Don't let Esc / outside-click dismiss a running action.
    if (!v && !pending.value) answer(false);
  }
});

async function onConfirm() {
  const action = request.value?.action;
  if (!action) {
    answer(true);
    return;
  }
  pending.value = true;
  try {
    await action();
    answer(true);
  } catch {
    // The action surfaces its own error toast; keep the dialog open to retry.
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent v-if="request" class="max-w-sm">
      <UiDialogHeader>
        <UiDialogTitle>{{
          t(request.titleKey, request.params ?? {})
        }}</UiDialogTitle>
        <UiDialogDescription>{{
          t(request.descriptionKey, request.params ?? {})
        }}</UiDialogDescription>
      </UiDialogHeader>
      <div class="flex justify-end gap-2">
        <UiButton
          variant="outline"
          icon="lucide:x"
          :disabled="pending"
          @click="answer(false)"
        >
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton
          :variant="request.destructive ? 'destructive' : 'default'"
          :icon="request.destructive ? 'lucide:trash-2' : 'lucide:check'"
          :pending="pending"
          @click="onConfirm"
          >{{ t(request.confirmKey) }}</UiButton
        >
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
