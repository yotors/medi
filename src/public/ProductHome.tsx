import { useTranslation } from 'react-i18next';
import { HeartPulse, ArrowRight } from 'lucide-react';
import { LanguageControl } from '../i18n';
import './product-home.css';
export default function ProductHome() {
  const { t } = useTranslation();
  return (
    <div className="product-home">
      <a href="#product-main" className="skip-link">
        {t('public:tour')}
      </a>
      <header className="product-header">
        <a className="product-brand" href="/" aria-label="Medi">
          <HeartPulse aria-hidden size={28} /> Medi
        </a>
        <LanguageControl />
        <a href="/staff">
          {t('public:signin')} <ArrowRight size={16} aria-hidden />
        </a>
      </header>
      <main id="product-main">
        <section className="product-hero">
          <div>
            <h1>{t('public:title')}</h1>
            <p>{t('public:intro')}</p>
            <div className="product-actions">
              <a className="primary" href="/staff">
                {t('public:signin')} <ArrowRight size={18} aria-hidden />
              </a>
              <a href="#workflows">{t('public:tour')}</a>
            </div>
          </div>
          <section className="product-preview" aria-labelledby="preview-title">
            <div className="preview-toolbar">
              <HeartPulse size={22} aria-hidden />
              <strong>Medi</strong>
            </div>
            <div className="preview-body">
              <h2 id="preview-title">{t('public:preview')}</h2>
              <p>{t('public:fictional')}</p>
              <table>
                <thead>
                  <tr>
                    <th>{t('public:patient')}</th>
                    <th>{t('public:task')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Hana Tesfaye</td>
                    <td>{t('public:taskName')}</td>
                  </tr>
                  <tr>
                    <td>Dawit Bekele</td>
                    <td>{t('public:taskNameTwo')}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </section>
        <section id="workflows" className="product-workflows">
          <h2>{t('public:storyTitle')}</h2>
          {['arrival', 'care', 'operations'].map((key) => (
            <article key={key}>
              <h3>{t(`public:${key}`)}</h3>
              <p>{t(`public:${key}Body`)}</p>
            </article>
          ))}
        </section>
        <section className="product-security">
          <h2>{t('public:securityTitle')}</h2>
          <p>{t('public:securityBody')}</p>
          <p>{t('public:limits')}</p>
          <a href="/staff">
            {t('public:signin')} <ArrowRight size={18} aria-hidden />
          </a>
        </section>
      </main>
      <footer>{t('public:footer')}</footer>
    </div>
  );
}
