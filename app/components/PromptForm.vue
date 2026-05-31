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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isInvalid(field: any): boolean {
  return field.state.meta.isTouched && !field.state.meta.isValid;
}
// Translate i18n-key validation messages for FieldError.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tErrors(errors: any[]): Array<{ message: string }> {
  return errors
    .filter(Boolean)
    .map((e) => ({ message: t(typeof e === 'string' ? e : e.message) }));
}
</script>

<template>
  <form @submit.prevent="form.handleSubmit">
    <UiFieldGroup>
      <form.Field v-slot="{ field }" name="value">
        <UiField :data-invalid="isInvalid(field)">
          <UiFieldLabel html-for="prompt-value">{{ t(labelKey) }}</UiFieldLabel>
          <UiInput
            id="prompt-value"
            :name="field.name"
            :model-value="field.state.value"
            :aria-invalid="isInvalid(field)"
            :placeholder="t(placeholderKey)"
            autofocus
            @blur="field.handleBlur"
            @input="
              field.handleChange(($event.target as HTMLInputElement).value)
            "
          />
          <UiFieldDescription v-if="descriptionKey">
            {{ t(descriptionKey) }}
          </UiFieldDescription>
          <UiFieldError
            v-if="isInvalid(field)"
            :errors="tErrors(field.state.meta.errors)"
          />
        </UiField>
      </form.Field>
    </UiFieldGroup>

    <div class="mt-5 flex justify-end gap-2">
      <UiButton type="button" variant="outline" @click="emit('cancel')">
        {{ t('common.cancel') }}
      </UiButton>
      <UiButton type="submit">{{ t(submitKey) }}</UiButton>
    </div>
  </form>
</template>
