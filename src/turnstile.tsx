import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: {
        sitekey: string;
        action: string;
        callback: (token: string) => void;
        "expired-callback": () => void;
        "error-callback": () => void;
      }) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("无法加载人机验证。"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function Turnstile({ siteKey, onToken, onFailure, resetKey }: {
  siteKey: string;
  onToken: (token: string) => void;
  onFailure: (failed: boolean) => void;
  resetKey: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    loadScript().then(() => {
      if (!active || !container.current) return;
      if (!window.turnstile) throw new Error("Turnstile did not initialize");
      widgetId.current = window.turnstile.render(container.current, {
        sitekey: siteKey,
        action: "create_link",
        callback: (value) => { onFailure(false); onToken(value); },
        "expired-callback": () => onToken(""),
        "error-callback": () => { onToken(""); onFailure(true); },
      });
    }).catch(() => { if (active) onFailure(true); });
    return () => {
      active = false;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, onToken, onFailure]);

  useEffect(() => {
    if (resetKey > 0 && widgetId.current && window.turnstile) {
      onToken("");
      onFailure(false);
      window.turnstile.reset(widgetId.current);
    }
  }, [resetKey, onToken, onFailure]);

  return <div className="turnstile-area">
    <div ref={container} />
  </div>;
}
