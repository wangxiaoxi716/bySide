// Hardware mode sync: ESP32 -> local Node server -> projection pages.
// The device POSTs /api/device/mode; this module receives the mode over SSE.
const MODE_EVENT = 'mode';

export function startModeSync(onMode) {
  let current = null;
  const apply = (payload) => {
    if (!payload || (payload.mode !== 'companion' && payload.mode !== 'chess')) return;
    if (payload.mode === current) return;
    current = payload.mode;
    try { onMode?.(payload.mode, payload); }
    catch (error) { console.error('mode sync handler failed', error); }
  };

  // Read the latest mode first, so a projection opened after the device
  // switched still lands on the right scene.
  fetch('/api/state', { cache: 'no-store' })
    .then((response) => response.ok ? response.json() : null)
    .then(apply)
    .catch(() => { /* the local sync server is optional */ });

  if (typeof EventSource !== 'function') return () => {};
  const source = new EventSource('/api/events');
  source.addEventListener(MODE_EVENT, (event) => {
    try { apply(JSON.parse(event.data)); } catch { /* ignore malformed event */ }
  });
  return () => source.close();
}
