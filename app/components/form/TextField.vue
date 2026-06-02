<script setup lang="ts">
// Reusable single text field for a TanStack form rendered with the shadcn Field
// primitives. Each form only declares the field's name, input id and i18n label
// keys; the form.Field render-slot and the invalid/error wiring live here.
defineProps<{
  // The owning TanStack form instance (its `.Field` render component is used).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any;
  name: string;
  inputId: string;
  labelKey: string;
  placeholderKey: string;
  descriptionKey?: string;
  autofocus?: boolean;
}>();

const { t } = useI18n();
const { isInvalid, fieldErrors } = useFormField();
</script>

<template>
  <component :is="form.Field" v-slot="{ field }" :name="name">
    <UiField :data-invalid="isInvalid(field)">
      <UiFieldLabel :html-for="inputId">{{ t(labelKey) }}</UiFieldLabel>
      <UiInput
        :id="inputId"
        :name="field.name"
        :model-value="field.state.value"
        :aria-invalid="isInvalid(field)"
        :placeholder="t(placeholderKey)"
        :autofocus="autofocus"
        @blur="field.handleBlur"
        @input="field.handleChange(($event.target as HTMLInputElement).value)"
      />
      <UiFieldDescription v-if="descriptionKey">
        {{ t(descriptionKey) }}
      </UiFieldDescription>
      <UiFieldError v-if="isInvalid(field)" :errors="fieldErrors(field)" />
    </UiField>
  </component>
</template>
