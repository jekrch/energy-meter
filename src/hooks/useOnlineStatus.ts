import { useEffect, useState } from 'react';

/**
 * The browser's own connectivity flag. Coarse — `navigator.onLine` only knows
 * whether an interface is up — but enough to hide Drive rows behind a
 * "reconnect" notice instead of letting every click fail on a fetch.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}
