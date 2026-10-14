import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/manrope';
import './styles.css';
const Screen = React.lazy(() => import('./staff/StaffApp'));
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <React.Suspense fallback={<p role="status">Loading workspace…</p>}>
      <Screen />
    </React.Suspense>
  </React.StrictMode>,
);
