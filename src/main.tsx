import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { QWorldSkyPreview } from './components/QWorldSkyPreview';
import { QWorldCalendarView } from './components/QWorldCalendarView';

const params = new URLSearchParams(window.location.search);
const isSkyView = params.get('view') === 'sky';
const isCalendarView = params.get('view') === 'calendar';

if (isSkyView) {
  document.title = 'Adventure2 — Celestial Sky Preview';
} else if (isCalendarView) {
  document.title = 'Adventure2 — World Calendar';
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isSkyView ? <QWorldSkyPreview /> : isCalendarView ? <QWorldCalendarView /> : <App />}
  </React.StrictMode>
);
