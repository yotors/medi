import i18n from 'i18next';
import { useState } from 'react';
import { Globe2 } from 'lucide-react';
import { initReactI18next, useTranslation } from 'react-i18next';
import { PreferenceMenu, PreferenceOption, Menu } from '../components/PreferenceMenu';
import AppearanceControl from '../appearance/AppearanceControl';
import { languages, type LanguageCode } from './languages';
export { languages } from './languages';
export type { TranslationKey, TranslationNamespace } from './resources';
const fallbackLanguage: LanguageCode = 'en';
const loaded = new Map<LanguageCode, Promise<void>>();
const messageKeys = new Map<string, string>();
function preference(): LanguageCode {
  try {
    const value = localStorage.getItem('medi.language');
    return languages.find((l) => l.code === value)?.code ?? fallbackLanguage;
  } catch {
    return fallbackLanguage;
  }
}
async function loadLanguage(code: LanguageCode) {
  let loading = loaded.get(code);
  if (!loading) {
    loading = (async () => {
      const language = languages.find((l) => l.code === code)!;
      const { default: catalogs } = await language.load();
      for (const [namespace, catalog] of Object.entries(catalogs)) {
        i18n.addResourceBundle(code, namespace, catalog, true, true);
        for (const [key, value] of Object.entries(catalog))
          messageKeys.set(value, `${namespace}:${key}`);
      }
    })();
    loaded.set(code, loading);
    loading.catch(() => loaded.delete(code));
  }
  await loading;
}
export async function changeLanguage(code: string, persist = true) {
  const language = languages.find((l) => l.code === code)?.code ?? fallbackLanguage;
  await loadLanguage(language);
  await i18n.changeLanguage(language);
  if (persist)
    try {
      localStorage.setItem('medi.language', language);
    } catch {
      /* The selected language still works in memory. */
    }
}
let initialization: Promise<void> | undefined;
export function initializeI18n() {
  return (initialization ??= (async () => {
    const selected = preference();
    await i18n.use(initReactI18next).init({
      resources: {},
      ns: ['common'],
      defaultNS: 'common',
      keySeparator: false,
      lng: fallbackLanguage,
      fallbackLng: fallbackLanguage,
      supportedLngs: languages.map((l) => l.code),
      interpolation: { escapeValue: false },
      returnEmptyString: false,
    });
    await loadLanguage(fallbackLanguage);
    try {
      await changeLanguage(selected, false);
    } catch {
      await changeLanguage(fallbackLanguage, false);
    }
  })());
}
i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
  document.documentElement.dir = languages.find((l) => l.code === language)?.direction ?? 'ltr';
});
export default i18n;
export const t = (key: string, options?: Record<string, unknown>) => String(i18n.t(key, options));
/** Interface-only state, never patient/catalog content. Messages resolve at render time. */
export function uiMessage(key: string, options?: Record<string, unknown>) {
  return '\u0001medi:' + JSON.stringify({ key, options });
}
export function interfaceMessage(value: string) {
  if (value.startsWith('\u0001medi:')) {
    try {
      const message = JSON.parse(value.slice(6));
      return t(message.key, message.options);
    } catch {
      return t('errors:REQUEST_FAILED');
    }
  }
  return t(messageKeys.get(value) ?? value);
}
export function LanguageControl() {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="language-switcher">
      <AppearanceControl />
      <PreferenceMenu
        disabled={busy}
        label={t('language:label')}
        icon={<Globe2 size={17} aria-hidden />}
      >
        <Menu.RadioGroup
          value={i18n.resolvedLanguage}
          onValueChange={async (code) => {
            if (busy) return;
            setBusy(true);
            setFailed(false);
            try {
              await changeLanguage(code);
            } catch {
              setFailed(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {languages.map((language) => (
            <PreferenceOption key={language.code} value={language.code}>
              <span lang={language.code}>{language.name}</span>
            </PreferenceOption>
          ))}
        </Menu.RadioGroup>
      </PreferenceMenu>
      {failed && <p role="alert">{t('common:language_loading_failed')}</p>}
    </div>
  );
}
export function formatNumber(value: number | bigint, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(
    languages.find((l) => l.code === i18n.resolvedLanguage)?.locale ?? 'en-ET',
    options,
  ).format(value);
}
export function formatCurrency(value: number, currency = 'ETB') {
  return formatNumber(value, { style: 'currency', currency });
}
export function formatDate(value: Date, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(
    languages.find((l) => l.code === i18n.resolvedLanguage)?.locale ?? 'en-ET',
    { timeZone: 'Africa/Addis_Ababa', ...options },
  ).format(value);
}
/** Use only for protocol enums, never free text. */
export function presentationLabel(value: unknown) {
  const key = `labels:enum.${String(value)}`;
  return i18n.exists(key) ? t(key) : String(value ?? '—');
}
export function fieldLabel(value: string) {
  return t('labels:fields.' + value, { defaultValue: value });
}
/** Exact display even when report values exceed Number.MAX_SAFE_INTEGER. */
export function formatMinorCurrency(minor: number | string | bigint, currency = 'ETB') {
  const amount = BigInt(minor),
    absolute = amount < 0n ? -amount : amount,
    whole = absolute / 100n;
  const locale = languages.find((l) => l.code === i18n.resolvedLanguage)?.locale ?? 'en-ET';
  const signed = amount < 0n ? (whole === 0n ? -0 : -whole) : whole;
  const parts = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(signed);
  return (
    parts
      .map((part) =>
        part.type === 'fraction'
          ? formatNumber(absolute % 100n, { minimumIntegerDigits: 2, useGrouping: false })
          : part.value,
      )
      .join('') +
    ' ' +
    currency
  );
}
