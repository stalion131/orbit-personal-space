import type { Metadata } from 'next';
import './globals.css';
import './notebook.css';
import { PwaInstall } from '@/components/pwa-install';
const title = 'Orbit — ваше рабочее пространство';
const description = 'Задачи, решения и история действий в одном личном пространстве.';
export const metadata: Metadata = { metadataBase: new URL(process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000'), title, description, manifest: '/manifest.webmanifest', icons: { icon: '/favicon.svg', apple: '/icons/orbit-192.png' }, openGraph: { title, description, images: [{url: '/og.png', width: 1536, height: 1024}] }, twitter: {card: 'summary_large_image', title, description, images: ['/og.png']}, robots: { index: false, follow: false }, appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Orbit' } };
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0b1020' };
export default function RootLayout({children}: {children: React.ReactNode}) {return <html lang="ru"><body>{children}<PwaInstall/></body></html>;}
