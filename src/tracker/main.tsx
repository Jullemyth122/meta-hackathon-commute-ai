import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TrackerApp } from './TrackerApp';
import '../styles/tracker.scss';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TrackerApp />
  </StrictMode>,
);
