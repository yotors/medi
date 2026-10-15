import { useEffect, useState } from 'react';
import { Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { appearance, setAppearance, type Appearance } from './index';
import { PreferenceMenu, PreferenceOption, Menu } from '../components/PreferenceMenu';
export default function AppearanceControl() {
  const { t } = useTranslation();
  const [value, setValue] = useState(appearance);
  useEffect(() => {
    const update = () => setValue(appearance());
    window.addEventListener('medi-appearance', update);
    return () => window.removeEventListener('medi-appearance', update);
  }, []);
  const update = (next: Appearance) => setAppearance(next);
  return (
    <PreferenceMenu compact label={t('common:appearance')} icon={<Palette size={17} aria-hidden />}>
      <Menu.Label className="preference-label">{t('common:mode')}</Menu.Label>
      <Menu.RadioGroup
        aria-label={t('common:mode')}
        value={value.mode}
        onValueChange={(mode) => update({ ...value, mode: mode as Appearance['mode'] })}
      >
        {(['light', 'dark', 'device'] as const).map((mode) => (
          <PreferenceOption key={mode} value={mode}>
            {t(`common:${mode}`)}
          </PreferenceOption>
        ))}
      </Menu.RadioGroup>
      <Menu.Separator className="preference-separator" />
      <Menu.Label className="preference-label">{t('common:accent')}</Menu.Label>
      <Menu.RadioGroup
        aria-label={t('common:accent')}
        value={value.accent}
        onValueChange={(accent) => update({ ...value, accent: accent as Appearance['accent'] })}
      >
        {(['teal', 'blue', 'violet'] as const).map((accent) => (
          <PreferenceOption key={accent} value={accent}>
            {t(`common:${accent}`)}
          </PreferenceOption>
        ))}
      </Menu.RadioGroup>
    </PreferenceMenu>
  );
}
