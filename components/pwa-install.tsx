'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Download, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

export function PwaInstall() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const ios = useSyncExternalStore(
    () => () => {},
    () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches,
    () => false,
  );

  useEffect(() => {
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js', { scope: '/' });
    function available(event: Event) { event.preventDefault(); setPrompt(event as InstallPrompt); }
    window.addEventListener('beforeinstallprompt', available);
    return () => window.removeEventListener('beforeinstallprompt', available);
  }, []);

  if (!prompt && !ios) return null;
  return <div className="pwa-wrap">
    <Button variant="outline" className="install-button" onClick={async () => {
      if (prompt) { await prompt.prompt(); const choice = await prompt.userChoice; if (choice.outcome === 'accepted') setPrompt(null); }
      else setShowIosHelp(value => !value);
    }}>{prompt ? <Download size={14}/> : <Smartphone size={14}/>}Установить на телефон</Button>
    {showIosHelp && <div className="ios-help">В Safari нажмите «Поделиться», затем «На экран Домой».</div>}
  </div>;
}
