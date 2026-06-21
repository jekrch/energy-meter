export const formatShortDate = (date: Date): string =>
  date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' });

// Month + 2-digit year, e.g. "Feb '24". `month` is 0-indexed.
export const formatMonthYear = (month: string, year: number): string =>
  `${month} '${String(year).slice(-2)}`;

// Chart time: 12-hour clock, no leading zero, no space before AM/PM,
// and minutes omitted entirely on the hour. e.g. "11PM", "11:15PM", "12AM".
export const formatChartTime = (date: Date): string => {
  const h = date.getHours();
  const m = date.getMinutes();
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, '0')}${period}`;
};

export const formatAxisValue = (v: number): string =>
  v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}K` : v.toString();

export const formatDateTimeLocal = (ts: number | null): string => {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const parseDateTimeLocal = (str: string): number | null =>
  str ? Math.floor(new Date(str).getTime() / 1000) : null;

// Helper to convert raw cost integer to dollars
export const toDollars = (cost: number): number => cost / 100000;

// Format cost as currency string
export const formatCost = (cost: number): string => {
  const dollars = toDollars(cost);
  return dollars.toLocaleString('en-US', { 
    style: 'currency', 
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2 
  });
};

// Format cost for axis labels (compact)
export const formatCostAxis = (cost: number): string => {
  const dollars = toDollars(cost);
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}k`;
  if (dollars >= 1) return `$${dollars.toFixed(0)}`;
  return `${(dollars * 100).toFixed(0)}¢`;
};
