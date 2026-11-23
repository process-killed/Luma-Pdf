// Lightweight performance marks (visible in DevTools and in Settings → diagnostics).
const PREFIX = 'luma:';

export function mark(name) {
  try { performance.mark(PREFIX + name); } catch { /* ignore */ }
}

export function measure(name, from) {
  try {
    performance.measure(PREFIX + name, PREFIX + from, PREFIX + name);
  } catch { /* ignore */ }
}

export function marks() {
  try {
    return performance.getEntriesByType('mark')
      .filter((m) => m.name.startsWith(PREFIX))
      .map((m) => ({ name: m.name.slice(PREFIX.length), at: Math.round(m.startTime) }))
      .sort((a, b) => a.at - b.at);
  } catch { return []; }
}

export function since(name) {
  const found = marks().find((m) => m.name === name);
  return found ? Math.round(found.at) : null;
}
