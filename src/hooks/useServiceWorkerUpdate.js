// src/hooks/useServiceWorkerUpdate.js
// Gets new releases to the installed PWA as quickly as to the website.
//
// The browser only checks for a new service worker on a navigation. A
// website tab is reloaded often; an installed PWA is mostly resumed from the
// background and can keep running an old build for days. So check explicitly:
// once when the app starts, on an interval, and every time it comes back to
// the foreground. The user chooses when to reload (registerType 'prompt' in
// vite.config.js), so an update never wipes a half-filled form.
import { useEffect, useRef, useState } from 'react';

const SW_UPDATE_INTERVAL_MS = 15 * 60 * 1000;

let registered = false;

/** @returns {{ needRefresh: boolean, reload: () => void, dismiss: () => void }} */
export function useServiceWorkerUpdate() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const updateRef = useRef(null);

  useEffect(() => {
    if (registered || typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    registered = true;

    // Loaded on demand: the module only exists in a vite-plugin-pwa build.
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        updateRef.current = registerSW({
          immediate: true,
          onNeedRefresh() {
            setNeedRefresh(true);
          },
          onRegisteredSW(swUrl, registration) {
            if (!registration) return;
            const checkForUpdate = () => {
              if (registration.installing || !navigator.onLine) return;
              registration.update().catch(() => {});
            };
            setInterval(checkForUpdate, SW_UPDATE_INTERVAL_MS);
            document.addEventListener('visibilitychange', () => {
              if (document.visibilityState === 'visible') checkForUpdate();
            });
            window.addEventListener('focus', checkForUpdate);
          },
        });
      })
      .catch((err) => console.warn('[pwa] Service worker registration unavailable:', err));
  }, []);

  return {
    needRefresh,
    // Activates the waiting service worker, then reloads onto the new build.
    reload: () => (updateRef.current ? updateRef.current(true) : window.location.reload()),
    dismiss: () => setNeedRefresh(false),
  };
}

export default useServiceWorkerUpdate;
