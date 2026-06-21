import { useState, useEffect } from 'react';

// useState whose value is mirrored to localStorage under `key`, so it survives
// remounts (e.g. a modal closing) and page reloads. Falls back to `fallback`
// when nothing is stored or storage is unavailable.
export function usePersistentState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore quota / availability errors */
    }
  }, [key, value]);

  return [value, setValue] as const;
}
