<script setup lang="ts">
// Initialise a new repository: pick a folder, optionally name the initial
// branch, then open it. Mounted once in app.vue.
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useForm } from '@tanstack/vue-form';
import { z } from 'zod';
import { toast } from 'vue-sonner';

const { open } = useOverlay('init');
const repo = useRepoStore();
const { t } = useI18n();

const folder = ref('');
const initialising = ref(false);

const form = useForm({
  defaultValues: { branch: '' },
  validators: { onSubmit: z.object({ branch: z.string() }) },
  onSubmit: async ({ value }) => {
    if (!folder.value) return;
    initialising.value = true;
    try {
      await repo.initRepo({
        parent: folder.value,
        branch: value.branch.trim() || undefined
      });
      open.value = false;
    } catch (e) {
      toast.error(t('init.failed'), { description: String(e) });
    } finally {
      initialising.value = false;
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
    title: t('init.title')
  });
  if (typeof path === 'string') folder.value = path;
}
</script>

<template>
  <UiDialog v-model:open="open">
    <UiDialogContent class="max-w-sm">
      <UiDialogHeader>
        <UiDialogTitle>{{ t('init.title') }}</UiDialogTitle>
        <UiDialogDescription class="sr-only">
          {{ t('init.title') }}
        </UiDialogDescription>
      </UiDialogHeader>

      <form id="init-form" @submit.prevent="form.handleSubmit">
        <UiFieldGroup>
          <UiField>
            <UiFieldLabel html-for="init-folder">{{
              t('init.folder.label')
            }}</UiFieldLabel>
            <div class="flex gap-2">
              <UiInput
                id="init-folder"
                readonly
                class="flex-1"
                :model-value="folder"
                :placeholder="t('init.folder.placeholder')"
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
          </UiField>
          <FormTextField
            :form="form"
            name="branch"
            input-id="init-branch"
            label-key="init.branch.label"
            placeholder-key="init.branch.placeholder"
            description-key="init.branch.description"
          />
        </UiFieldGroup>
      </form>

      <div class="flex justify-end gap-2">
        <UiButton variant="outline" type="button" @click="open = false">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton
          type="submit"
          form="init-form"
          :disabled="!folder"
          :pending="initialising"
        >
          {{ t('init.submit') }}
        </UiButton>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
