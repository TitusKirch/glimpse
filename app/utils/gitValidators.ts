// Zod schemas for the git form dialogs. Validation messages are i18n keys; the
// form dialogs translate them with t() when rendering field errors.
import { z } from 'zod';

// git refnames can't contain whitespace or ~ ^ : ? * [ \ (a pragmatic subset
// of git-check-ref-format).
const REF_INVALID = /[\s~^:?*[\]\\]/;

// A pragmatic git-check-ref-format. The leading-`-` check is the security-
// relevant one (a name like `-D`/`--upload-pack=…` would be parsed as a git
// option); the rest aligns the UX message with what git would reject anyway.
// The backend re-validates regardless (see git.rs reject_option) — this schema
// is only the form-level nicety, never the security boundary.
function isValidRef(v: string): boolean {
  return (
    !v.startsWith('-') &&
    !REF_INVALID.test(v) &&
    !v.includes('..') &&
    !v.includes('@{') &&
    !v.startsWith('/') &&
    !v.endsWith('/') &&
    !v.endsWith('.lock') &&
    v !== 'HEAD' &&
    ![...v].some((c) => c.charCodeAt(0) < 0x20)
  );
}

export const branchNameSchema = z
  .string()
  .trim()
  .min(1, 'form.validation.required')
  .refine(isValidRef, 'form.validation.invalidRef');

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
