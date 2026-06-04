<script setup lang="ts">
// Clone a remote repository into a chosen folder, then open it. Mounted once in
// app.vue. The repo folder name is derived from the URL by git.
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useForm } from '@tanstack/vue-form';
import { z } from 'zod';
import { toast } from 'vue-sonner';

const { open } = useOverlay('clone');
const repo = useRepoStore();
const { t } = useI18n();

const folder = ref('');
const cloning = ref(false);

const form = useForm({
  defaultValues: { url: '' },
  validators: { onSubmit: z.object({ url: remoteUrlSchema }) },
  onSubmit: async ({ value }) => {
    if (!folder.value) return;
    cloning.value = true;
    try {
      await repo.cloneRepo({ url: value.url.trim(), parent: folder.value });
      open.value = false;
    } catch (e) {
      toast.error(t('clone.failed'), { description: String(e) });
    } finally {
      cloning.value = false;
    }
  }
});

watch(open, (isOpen) => {
  if (isOpen) {
    form.reset();
    folder.value = '';
  }
});

async function pickFolder() {
  if (!isTauri()) return;
  const path = await openDialog({
    directory: true,
    multiple: false,
    title: t('clone.title')
  });
  if (typeof path === 'string') folder.value = path;
}
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent class="max-w-sm">
      <UiDialogHeader>
        <UiDialogTitle>{{ t('clone.title') }}</UiDialogTitle>
        <UiDialogDescription class="sr-only">
          {{ t('clone.title') }}
        </UiDialogDescription>
      </UiDialogHeader>

      <form id="clone-form" @submit.prevent="form.handleSubmit">
        <UiFieldGroup>
          <FormTextField
            :form="form"
            name="url"
            input-id="clone-url"
            label-key="clone.url.label"
            placeholder-key="clone.url.placeholder"
            description-key="clone.url.description"
            autofocus
          />
          <UiField>
            <UiFieldLabel html-for="clone-folder">{{
              t('clone.folder.label')
            }}</UiFieldLabel>
            <div class="flex gap-2">
              <UiInput
                id="clone-folder"
                readonly
                class="flex-1"
                :model-value="folder"
                :placeholder="t('clone.folder.placeholder')"
              />
              <UiButton
                type="button"
                variant="outline"
                icon="lucide:folder-open"
                @click="pickFolder"
              >
                {{ t('common.browse') }}
              </UiButton>
            </div>
            <UiFieldDescription>{{
              t('clone.folder.description')
            }}</UiFieldDescription>
          </UiField>
        </UiFieldGroup>
      </form>

      <div class="flex justify-end gap-2">
        <UiButton variant="outline" type="button" @click="open = false">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton
          type="submit"
          form="clone-form"
          :disabled="!folder"
          :pending="cloning"
        >
          {{ t('clone.submit') }}
        </UiButton>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
