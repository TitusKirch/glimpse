// Zod schemas for the git form dialogs. Validation messages are i18n keys; the
// form dialogs translate them with t() when rendering field errors.
import { z } from 'zod';

// git refnames can't contain whitespace or ~ ^ : ? * [ \ (a pragmatic subset
// of git-check-ref-format).
const REF_INVALID = /[\s~^:?*[\]\\]/;

export const branchNameSchema = z
  .string()
  .trim()
  .min(1, 'form.validation.required')
  .refine((v) => !REF_INVALID.test(v), 'form.validation.invalidRef');

export const tagNameSchema = branchNameSchema;

export const remoteNameSchema = z
  .string()
  .trim()
  .min(1, 'form.validation.required')
  .refine((v) => /^[\w][\w.-]*$/.test(v), 'form.validation.invalidRemoteName');

export const remoteUrlSchema = z
  .string()
  .trim()
  .min(1, 'form.validation.required')
  .refine(
    (v) =>
      /^(https?:\/\/|git@|ssh:\/\/|git:\/\/|file:\/\/|\.\.?\/|\/|~).+/.test(v),
    'form.validation.invalidUrl'
  );
