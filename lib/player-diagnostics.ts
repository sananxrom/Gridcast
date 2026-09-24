/** Diagnostic reports have their own durable store and never pass through the commercial queue. */
const key = (device: string) => 'gc_diagnostic_result:' + device;
export function pendingDiagnostic(device: string): any | null {
  const raw = localStorage.getItem(key(device));
  return raw ? JSON.parse(raw) : null;
}
export function saveDiagnostic(device: string, event: any) {
  if (pendingDiagnostic(device)) throw new Error('The previous diagnostic result still needs delivery.');
  localStorage.setItem(key(device), JSON.stringify({ event, created_at: Date.now() }));
}
export async function flushDiagnostic(device: string, send: (body: any) => Promise<{ status: number; value: any }>): Promise<string | null> {
  const row = pendingDiagnostic(device); if (!row) return null;
  if (row.blocked) return row.error;
  if (Date.now() - row.created_at > 864e5) {
    row.blocked = true; row.error = 'Diagnostic report expired; saved locally for review.';
    localStorage.setItem(key(device), JSON.stringify(row)); return row.error;
  }
  try {
    const response = await send(row.event);
    if (response.status < 300 && response.value.ok === true) { localStorage.removeItem(key(device)); return 'Diagnostic result saved. Counts are excluded from commercial reports.'; }
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      row.blocked = true; row.error = response.value.error || 'Diagnostic result rejected; saved locally for review.';
      localStorage.setItem(key(device), JSON.stringify(row)); return row.error;
    }
  } catch {}
  return 'Diagnostic result saved on this device; waiting for connection.';
}
