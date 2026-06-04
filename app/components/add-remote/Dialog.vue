<script setup lang="ts">
// Add-remote form (name + url) — TanStack Form + Zod. Mounted once in app.vue.
import { useForm } from '@tanstack/vue-form';
import { z } from 'zod';

const { open } = useOverlay('remote');
const repo = useRepoStore();
const { t } = useI18n();

const schema = z.object({
  name: remoteNameSchema,
  url: remoteUrlSchema
});

const form = useForm({
  defaultValues: { name: '', url: '' },
  validators: { onSubmit: schema },
  onSubmit: async ({ value }) => {
    await repo.addRemote({ name: value.name.trim(), url: value.url.trim() });
    open.value = false;
  }
});

// Reset the form each time the dialog opens.
watch(open, (isOpen) => {
  if (isOpen) form.reset();
});
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

      <form id="add-remote-form" @submit.prevent="form.handleSubmit">
        <UiFieldGroup>
          <FormTextField
            :form="form"
            name="name"
            input-id="remote-name"
            label-key="form.remoteName.label"
            placeholder-key="form.remoteName.placeholder"
            autofocus
          />
          <FormTextField
            :form="form"
            name="url"
            input-id="remote-url"
            label-key="form.remoteUrl.label"
            placeholder-key="form.remoteUrl.placeholder"
            description-key="form.remoteUrl.description"
          />
        </UiFieldGroup>
      </form>

      <div class="flex justify-end gap-2">
        <UiButton
          variant="outline"
          type="button"
          icon="lucide:x"
          @click="open = false"
        >
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton type="submit" form="add-remote-form" icon="lucide:plus">
          {{ t('sidebar.addRemote') }}
        </UiButton>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
