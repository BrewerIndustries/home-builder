import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { SharedView } from './account/SharedView.tsx';
import { shareTokenFrom } from './model/share.ts';
import './styles.css';

// A read-only share link (?share=…) opens the viewer instead of the editor.
const share = shareTokenFrom(location.search);

createRoot(document.getElementById('root')!).render(<StrictMode>{share ? <SharedView token={share} /> : <App />}</StrictMode>);
