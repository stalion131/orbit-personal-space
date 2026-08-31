import type { Metadata } from 'next';
import './globals.css';
const title = 'Orbit — ваше рабочее пространство';
const description = 'Задачи, решения и история действий в одном личном пространстве.';
export const metadata: Metadata = { title, description, metadataBase: new URL('http://127.0.0.1:3000'), icons: { icon: '/favicon.svg' }, openGraph: { title, description, images: [{url: '/og.png', width: 1536, height: 1024}] }, twitter: {card: 'summary_large_image', title, description, images: ['/og.png']}, robots: { index: false, follow: false } };
export default function RootLayout({children}: {children: React.ReactNode}) {return <html lang="ru"><body>{children}</body></html>;}
