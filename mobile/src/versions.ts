/**
 * Compares version numbers like "2.0.56" and "2.0.9" part by part as numbers (so 2.0.10 is newer than 2.0.9).
 * Returns a negative number when a is older than b, 0 when equal, positive when a is newer. Missing parts count as 0.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0);
  const pb = b.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export interface VersionRow { latest: string; minimum: string; url: string; message: string }
export interface UpdateInfo { required: boolean; latest: string; url: string; message: string }

/** What to show for this app's version: nothing (null), an optional update, or a required one. */
export function updateFor(current: string, row: VersionRow): UpdateInfo | null {
  if (compareVersions(current, row.latest) >= 0) return null;
  return { required: compareVersions(current, row.minimum) < 0, latest: row.latest, url: row.url, message: row.message };
}
