export function median(arr) {
  if (!arr || arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mad(arr) {
  const center = median(arr);
  if (!Number.isFinite(center)) return NaN;
  return median(arr.map((value) => Math.abs(value - center)));
}

export function binBy(values, edges) {
  const bins = Array.from({ length: edges.length + 1 }, () => []);
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    let index = 0;
    while (index < edges.length && value > edges[index]) index += 1;
    bins[index].push(value);
  }
  return bins;
}

export function enoughSamples(n, min) {
  return Number.isFinite(n) && n >= min;
}
