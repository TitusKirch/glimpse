<script setup lang="ts">
// Single text-field form (TanStack Form + Zod) for the prompt dialog. Remounted
// per request (keyed) so each prompt gets a fresh form with its own schema.
import { useForm } from '@tanstack/vue-form';
import { z } from 'zod';

const props = defineProps<{
  labelKey: string;
  descriptionKey?: string;
  placeholderKey: string;
  submitKey: string;
  initial: string;
  schema: z.ZodType<string>;
}>();
const emit = defineEmits<{ submit: [value: string]; cancel: [] }>();
const { t } = useI18n();

const form = useForm({
  defaultValues: { value: props.initial },
  validators: { onSubmit: z.object({ value: props.schema }) },
  onSubmit: ({ value }) => emit('submit', value.value.trim())
});
</script>

<template>
  <form @submit.prevent="form.handleSubmit">
    <UiFieldGroup>
      <FormTextField
        :form="form"
        name="value"
        input-id="prompt-value"
        :label-key="labelKey"
        :placeholder-key="placeholderKey"
        :description-key="descriptionKey"
        autofocus
      />
    </UiFieldGroup>

    <div class="mt-5 flex justify-end gap-2">
      <UiButton type="button" variant="outline" @click="emit('cancel')">
        {{ t('common.cancel') }}
      </UiButton>
      <UiButton type="submit">{{ t(submitKey) }}</UiButton>
    </div>
  </form>
</template>
