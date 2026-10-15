import { LogOut, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Session } from '../../shared/registration';
import { PreferenceMenu, Menu } from '../components/PreferenceMenu';
import { isPlainLinkClick, surfacePath, type Surface } from './navigation';
export default function AccountMenu({
  session,
  settingsAvailable,
  blocked,
  route,
  onNavigate,
  onSignOut,
}: {
  session: Session;
  settingsAvailable: boolean;
  blocked: boolean;
  route: Surface | null;
  onNavigate: (surface: Surface) => boolean;
  onSignOut: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="account-menu">
      <PreferenceMenu
        label={session.user.displayName}
        triggerLabel={`${t('navigation:account')}: ${session.user.displayName}`}
        icon={<UserRound size={19} aria-hidden />}
      >
        <Menu.Label className="preference-label">{t('navigation:account')}</Menu.Label>
        {settingsAvailable && (
          <>
            {(['password', 'mfa'] as const).map((surface) => (
              <Menu.Item key={surface} asChild disabled={blocked}>
                <a
                  className="preference-option account-link"
                  href={surfacePath(surface)}
                  aria-current={route === surface ? 'page' : undefined}
                  aria-disabled={blocked || undefined}
                  onClick={(event) => {
                    if (blocked) {
                      event.preventDefault();
                      return;
                    }
                    if (!isPlainLinkClick(event)) return;
                    event.preventDefault();
                    onNavigate(surface);
                  }}
                >
                  {t(`navigation:${surface}`)}
                </a>
              </Menu.Item>
            ))}
            <Menu.Separator className="preference-separator" />
          </>
        )}
        <Menu.Item asChild disabled={blocked}>
          <button
            className="preference-option account-signout"
            disabled={blocked}
            onClick={onSignOut}
          >
            <LogOut size={16} aria-hidden />
            {t('common:sign_out')}
          </button>
        </Menu.Item>
      </PreferenceMenu>
    </div>
  );
}
