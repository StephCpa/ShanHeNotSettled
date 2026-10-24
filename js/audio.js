/* ═════════════════════════════════════════════════
   十六国 · 山河未定 — 提示音（军令确认 / 新报 / 回合完成）
   关键规则不依赖音频；可在设置中关闭
   ═════════════════════════════════════════════════ */
window.SHL = window.SHL || {};
SHL.Audio = (function () {
  let ctx = null;
  let enabled = true;
  function ac() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type, vol, when, glide) {
    const c = ac(); if (!c || !enabled) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'triangle'; o.frequency.value = freq;
    if (glide) o.frequency.exponentialRampToValueAtTime(glide, c.currentTime + when + dur);
    g.gain.setValueAtTime(0.0001, c.currentTime + when);
    g.gain.exponentialRampToValueAtTime(vol || 0.12, c.currentTime + when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + when + dur);
    o.connect(g); g.connect(c.destination);
    o.start(c.currentTime + when); o.stop(c.currentTime + when + dur + 0.05);
  }
  return {
    setEnabled(v) { enabled = !!v; },
    /* 军令确认 — 短促琴拨 */
    confirm() { tone(523, 0.12, 'triangle', 0.10, 0); tone(784, 0.16, 'triangle', 0.08, 0.06); },
    /* 收到新报 — 两声渐高 */
    intel() { tone(392, 0.14, 'sine', 0.12, 0); tone(587, 0.2, 'sine', 0.10, 0.12); },
    /* 回合完成 — 低钟 */
    turn() { tone(196, 0.5, 'sine', 0.14, 0, 130); tone(392, 0.4, 'triangle', 0.05, 0.08); },
    /* 战斗警报 */
    alert() { tone(233, 0.18, 'square', 0.06, 0); tone(233, 0.18, 'square', 0.06, 0.22); },
    /* 按钮轻响 */
    tick() { tone(880, 0.04, 'sine', 0.04, 0); },
  };
})();
