import type { Metadata } from 'next';
import { Bricolage_Grotesque, Work_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
});

const workSans = Work_Sans({
  subsets: ['latin'],
  variable: '--font-work-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'PantryMind',
  description: 'An agentic pantry assistant that remembers what you actually cook.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${workSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
