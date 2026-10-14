export type EnglishResources = typeof import('./en').default;
export type TranslationNamespace = keyof EnglishResources;
export type TranslationKey = {
  [N in TranslationNamespace]: `${N}:${Extract<keyof EnglishResources[N], string>}`;
}[TranslationNamespace];
