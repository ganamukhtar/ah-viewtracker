/** A displayed total that only moves up. A higher snapshot eases in; a lower one never pulls the figure down. */
export function createLiveCounter() {
  let shown = null;
  let base = 0;
  let anchor = 0;
  let perSecond = 0;
  let catchup = 0;

  function sample(now) {
    if (shown == null || !Number.isFinite(now)) return shown;
    const elapsed = Math.max(0, (now - anchor) / 1000);
    const eased = catchup * (1 - Math.exp(-elapsed / 1.1));
    const target = base + perSecond * elapsed + eased;
    if (target > shown) shown = target;
    return shown;
  }

  function push(recorded, rate, now) {
    const speed = typeof rate === 'number' && rate > 0 ? rate : 0;
    const current = sample(now);
    if (typeof recorded !== 'number') {
      perSecond = speed;
      return current;
    }
    if (current == null) {
      shown = recorded;
      base = recorded;
      anchor = now;
      catchup = 0;
      perSecond = speed;
      return shown;
    }
    shown = current;
    base = shown;
    anchor = now;
    catchup = recorded > shown ? recorded - shown : 0;
    perSecond = speed;
    return shown;
  }

  return { push, sample };
}
