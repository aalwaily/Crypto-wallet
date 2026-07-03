import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Recover } from './Recover';
import '../popup/styles.css';
import './recover.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <Recover />
  </StrictMode>,
);
