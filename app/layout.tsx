import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Gridcast',
  description: 'The AdEngine for the physical world — verified impressions on every screen.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
