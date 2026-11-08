import type { Field } from './manageFormModel';

/** The name of a bucket or a site, as the charts of the applications check it: 3 to 30 lowercase letters, digits, "-". */
export const BLOCK_NAME = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

/** The name field of a new bucket or site (it cannot change afterwards). */
export const BLOCK_NAME_FIELD = (label: string, help?: string): Field => ({
  key: 'name',
  label,
  kind: 'text',
  required: true,
  createOnly: true,
  help,
  pattern: { re: BLOCK_NAME, message: 'lowercase letters, digits and "-", 3 to 30 characters' },
});
