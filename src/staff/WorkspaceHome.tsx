import { isPlainLinkClick } from './navigation';
import { presentationLabel } from '../i18n';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Session } from '../../shared/registration';
import type { VisitPage } from '../../shared/outpatient';
import { destinations, surfacePath, type Surface } from './navigation';
import { request, ApiError } from './api';
export default function WorkspaceHome({
  session,
  onNavigate,
  onSessionError,
}: {
  session: Session;
  onNavigate: (id: Surface) => void;
  onSessionError: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<VisitPage | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void request<VisitPage>('/api/visits/search', {
      method: 'POST',
      headers: { 'X-CSRF-Token': session.csrfToken },
      body: JSON.stringify({ q: '', status: 'active', assigned: 'all', page: 1 }),
    })
      .then((result) => {
        if (active) setQueue(result);
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) onSessionError(error);
        else setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [session.csrfToken]);
  const tasks = destinations(session.user.role).filter(
    (d) => d.group === 'work' && d.id !== 'home',
  );
  return (
    <section className="workspace-home">
      <h1>{t('home:title')}</h1>
      <p>{t('home:role', { role: t(`labels:roles.${session.user.role}`) })}</p>
      <p className="muted">{t('home:help')}</p>
      <h2>{t('home:tasks')}</h2>
      <ul className="home-tasks">
        {tasks.map((d) => (
          <li key={d.id}>
            <a
              href={surfacePath(d.id)}
              onClick={(e) => {
                if (!isPlainLinkClick(e)) return;
                e.preventDefault();
                onNavigate(d.id);
              }}
            >
              {t(d.label)}
            </a>
          </li>
        ))}
      </ul>
      <section className="panel">
        <h2>{t('home:queue')}</h2>
        <p>{t('home:queueHelp')}</p>
        {failed ? (
          <p role="alert">{t('home:failed')}</p>
        ) : !queue ? (
          <p role="status">{t('home:loading')}</p>
        ) : !queue.visits.length ? (
          <p>{t('home:empty')}</p>
        ) : (
          <ul className="home-queue">
            {queue.visits.slice(0, 5).map((visit) => (
              <li key={visit.id}>
                <span>{visit.patient.name}</span>
                <a
                  href="/staff/visits"
                  onClick={(e) => {
                    if (!isPlainLinkClick(e)) return;
                    e.preventDefault();
                    onNavigate('visits');
                  }}
                >
                  {t('navigation:visits')}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
