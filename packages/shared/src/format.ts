/** Presentation helpers shared by the web app and the PDF certificate. */

export function truncateHash(hash: string | null | undefined, lead = 6, tail = 4): string {
  if (!hash) return '—';
  if (hash.length <= lead + tail + 3) return hash;
  return hash.slice(0, lead) + '…' + hash.slice(-tail);
}

export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return (value * 100).toFixed(decimals) + '%';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return bytes + ' B';
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return value.toFixed(value >= 100 ? 0 : 1) + ' ' + units[unitIndex];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Stable UTC formatting so the UI and the PDF never disagree by a timezone. */
export function formatDateUTC(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = MONTHS[date.getUTCMonth()];
  return day + ' ' + month + ' ' + date.getUTCFullYear();
}

export function formatDateTimeUTC(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const time = date.toISOString().slice(11, 19);
  return formatDateUTC(iso) + ' ' + time + ' UTC';
}
