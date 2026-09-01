import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Orbit — личное пространство',
    short_name: 'Orbit',
    description: 'Задачи, сроки и решения по всем сферам жизни.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b1020',
    theme_color: '#0b1020',
    lang: 'ru',
    icons: [
      { src: '/icons/orbit-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/orbit-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/orbit-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
