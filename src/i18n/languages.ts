/** Add a catalog module and one registry entry to support another language. */
export const languages = [
  { code: 'en', name: 'English', locale: 'en-ET', direction: 'ltr', load: () => import('./en') },
  { code: 'am', name: 'አማርኛ', locale: 'am-ET', direction: 'ltr', load: () => import('./am') },
] as const;
export type LanguageCode = (typeof languages)[number]['code'];
