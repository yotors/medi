import React from 'react';
import { z } from 'zod';
// Avoid Zod's dynamic-code capability probe under the strict browser CSP.
z.config({ jitless: true });
import { initializeAppearance } from './appearance';
initializeAppearance();
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';
import './styles.css';
import './appearance/tokens.css';
import '@fontsource/noto-sans-ethiopic';
import './i18n';
import { I18nextProvider, useTranslation } from 'react-i18next';
import i18n, { initializeI18n, t } from './i18n';
import ProductHome from './public/ProductHome';
function Loading() {
  const { t } = useTranslation();
  return <p role="status">{t('common:loading_workspace')}</p>;
}
const Screen = React.lazy(() => import('./staff/StaffApp'));
const root = ReactDOM.createRoot(document.getElementById('root')!);
void initializeI18n()
  .then(() =>
    root.render(
      <React.StrictMode>
        <React.Suspense fallback={<Loading />}>
          <I18nextProvider i18n={i18n}>
            {window.location.pathname === '/' ? <ProductHome /> : <Screen />}
          </I18nextProvider>
        </React.Suspense>
      </React.StrictMode>,
    ),
  )
  .catch(() =>
    root.render(
      <main>
        <h1>Medi</h1>
        <p role="alert">
          {t('common:workspace_unavailable', { defaultValue: 'Workspace unavailable' })}
        </p>
        <button onClick={() => window.location.reload()}>
          {t('common:retry_connection', { defaultValue: 'Retry connection' })}
        </button>
      </main>,
    ),
  );
