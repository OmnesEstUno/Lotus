import { useEffect, useRef } from 'react';

interface TurnstileWidgetProps {
  siteKey: string;
  onToken: (token: string) => void;
  theme?: 'auto' | 'light' | 'dark';
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        opts: { sitekey: string; callback: (token: string) => void; theme?: string; 'expired-callback'?: () => void; 'error-callback'?: () => void },
      ) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId?: string) => void;
    };
  }
}

export default function TurnstileWidget({ siteKey, onToken, theme = 'auto' }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    function tryRender() {
      if (cancelled) return;
      if (!window.turnstile) {
        window.setTimeout(tryRender, 100);
        return;
      }
      if (!containerRef.current) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme,
        callback: (token) => onToken(token),
        'expired-callback': () => onToken(''),
        'error-callback': () => onToken(''),
      });
    }
    tryRender();
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current); } catch { /* noop */ }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, onToken, theme]);

  return <div ref={containerRef} className="turnstile-widget" />;
}
