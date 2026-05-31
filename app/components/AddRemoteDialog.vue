<script setup lang="ts">
// Add-remote form (name + url) — TanStack Form + Zod. Mounted once in app.vue.
import { useForm } from '@tanstack/vue-form';
import { z } from 'zod';

const { open } = useRemoteDialog();
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
    await repo.addRemote(value.name.trim(), value.url.trim());
    open.value = false;
  }
});

// Reset the form each time the dialog opens.
watch(open, (isOpen) => {
  if (isOpen) form.reset();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isInvalid(field: any): boolean {
  return field.state.meta.isTouched && !field.state.meta.isValid;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tErrors(errors: any[]): Array<{ message: string }> {
  return errors
    .filter(Boolean)
    .map((e) => ({ message: t(typeof e === 'string' ? e : e.message) }));
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

      <form id="add-remote-form" @submit.prevent="form.handleSubmit">
        <UiFieldGroup>
          <form.Field v-slot="{ field }" name="name">
            <UiField :data-invalid="isInvalid(field)">
              <UiFieldLabel html-for="remote-name">
                {{ t('form.remoteName.label') }}
              </UiFieldLabel>
              <UiInput
                id="remote-name"
                :name="field.name"
                :model-value="field.state.value"
                :aria-invalid="isInvalid(field)"
                :placeholder="t('form.remoteName.placeholder')"
                autofocus
                @blur="field.handleBlur"
                @input="
                  field.handleChange(($event.target as HTMLInputElement).value)
                "
              />
              <UiFieldError
                v-if="isInvalid(field)"
                :errors="tErrors(field.state.meta.errors)"
              />
            </UiField>
          </form.Field>

          <form.Field v-slot="{ field }" name="url">
            <UiField :data-invalid="isInvalid(field)">
              <UiFieldLabel html-for="remote-url">
                {{ t('form.remoteUrl.label') }}
              </UiFieldLabel>
              <UiInput
                id="remote-url"
                :name="field.name"
                :model-value="field.state.value"
                :aria-invalid="isInvalid(field)"
                :placeholder="t('form.remoteUrl.placeholder')"
                @blur="field.handleBlur"
                @input="
                  field.handleChange(($event.target as HTMLInputElement).value)
                "
              />
              <UiFieldDescription>
                {{ t('form.remoteUrl.description') }}
              </UiFieldDescription>
              <UiFieldError
                v-if="isInvalid(field)"
                :errors="tErrors(field.state.meta.errors)"
              />
            </UiField>
          </form.Field>
        </UiFieldGroup>
      </form>

      <div class="flex justify-end gap-2">
        <UiButton variant="outline" type="button" @click="open = false">
          {{ t('common.cancel') }}
        </UiButton>
        <UiButton type="submit" form="add-remote-form">
          {{ t('sidebar.addRemote') }}
        </UiButton>
      </div>
    </UiDialogContent>
  </UiDialog>
</template>
