export const formatShortDate = (date: Date): string =>
  date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' });

export const formatAxisValue = (v: number): string =>
  v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}K` : v.toString();

export const formatDateTimeLocal = (ts: number | null): string => {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const parseDateTimeLocal = (str: string): number | null =>
  str ? Math.floor(new Date(str).getTime() / 1000) : null;