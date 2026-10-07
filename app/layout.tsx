import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Gridcast',
  robots: { index: false, follow: false },
  description: 'The AdEngine for the physical world — verified playback and measured presence on every screen.',
};

// Runs before first paint so a dark-mode user never sees a white flash. The player keeps its own fixed styling.
const themeScript = `(function(){try{if(location.pathname.indexOf('/player')===0)return;var t=localStorage.getItem('gc_theme');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
