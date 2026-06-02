// Shared wiring for TanStack Form fields rendered with the shadcn Field
// primitives: whether a touched field is currently invalid, and its validation
// errors translated from i18n keys into the shape <UiFieldError> expects. Every
// form dialog used to restate these two helpers; they now live here once.

export function useFormField() {
  const { t } = useI18n();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function isInvalid(field: any): boolean {
    return field.state.meta.isTouched && !field.state.meta.isValid;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function fieldErrors(field: any): Array<{ message: string }> {
    return field.state.meta.errors.filter(Boolean).map((e: unknown) => ({
      message: t(typeof e === 'string' ? e : (e as { message: string }).message)
    }));
  }

  return { isInvalid, fieldErrors };
}
