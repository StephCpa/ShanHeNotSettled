/* ═════════════════════════════════════════════════
   十六国 · 山河未定 — 主入口与路由
   ═════════════════════════════════════════════════ */
window.SHL = window.SHL || {};

(function () {
  'use strict';
  const D = SHL.DATA;
  const State = SHL.State;

  let lastCityClick = 0;

  /* ── 地图拾取路由 ── */
  function onMapPick(pick) {
    if (!pick) {
      // 点空处：取消选择
      SHL.UI.ui.selNode = null; SHL.UI.ui.selLegion = null;
      SHL.UI.renderCommandBar(); SHL.UI.renderLeftPanel();
      return;
    }
    if (pick.type === 'region') {
      const r = D.regions[pick.id];
      if (pick.id === 'huainan') {
        SHL.Map3D.switchLevel('theater');
        SHL.UI.setBreadcrumb('theater');
      } else {
        SHL.UI.toast(`「${r ? r.name : pick.id}」地域包尚未开放 —— 剧本范围外仅有贸易与外交摘要`, 'info');
      }
      return;
    }
    if (pick.type === 'node') {
      // 行军待选状态：点击即为目标
      if (SHL.UI.ui.marchPending) {
        SHL.Map3D.focusNode(pick.id);
        SHL.UI.showMarchPreview(pick.id);
        return;
      }
      const now = Date.now();
      SHL.UI.pickNode(pick.id);
      // 双击城池 → 直接打开详情
      const n = D.theaterHuainan.nodes[pick.id];
      if (n && n.type === 'city' && now - lastCityClick < 500) {
        SHL.UI.openCity(pick.id);
      }
      lastCityClick = now;
    }
  }

  function onLevelChanged(lv) {
    if (lv === 'esc') {
      // Esc：走各覆盖层自己的关闭通道（含 3D 场景 dispose），或战区→天下
      const overlay = document.querySelector('.ov-mask');
      if (overlay) {
        const closer = overlay.querySelector('.ov-close');
        if (closer) closer.click(); else overlay.remove();
        return;
      }
      if ($('#settle-overlay') && !$('#settle-overlay').classList.contains('hidden')) return;
      if (SHL.Map3D.getLevel() === 'theater') {
        SHL.Map3D.switchLevel('world');
        SHL.UI.setBreadcrumb('world');
      }
      return;
    }
    if (lv === 'world' || lv === 'theater') {
      SHL.UI.setBreadcrumb(lv);
      if (lv === 'world') SHL.UI.setSiteBreadcrumb(null);
    }
  }

  /* ── 军团标签点击（事件委托） ── */
  function bindLabelDelegation() {
    document.getElementById('map-labels').addEventListener('click', (e) => {
      const lg = e.target.closest('.map-label.legion');
      if (lg && lg.dataset.legionId) {
        SHL.UI.openLegion(lg.dataset.legionId);
      }
    });
  }

  /* ── 继续上局按钮 ── */
  function bindContinue() {
    if (!State.hasSave()) return;
    const btn = document.createElement('button');
    btn.className = 'btn primary';
    btn.textContent = '继续上局';
    btn.style.marginRight = '10px';
    btn.addEventListener('click', () => {
      if (State.load()) {
        SHL.Audio.confirm();
        SHL.UI.enterStrategy();
      } else {
        SHL.UI.toast('存档版本不符，已舍弃', '');
      }
    });
    document.querySelector('.ch-head-right').prepend(btn);
  }

  /* ── 启动 ── */
  window.addEventListener('DOMContentLoaded', () => {
    // 首次交互解锁音频
    const unlock = () => { SHL.Audio.tick(); window.removeEventListener('pointerdown', unlock); };
    window.addEventListener('pointerdown', unlock);

    SHL.Map3D.init({
      canvas: document.getElementById('gl'),
      onPick: onMapPick,
      onLevel: onLevelChanged,
      onHover: (h) => {},
    });

    SHL.UI.init();
    bindLabelDelegation();
    bindContinue();

    // 默认预选：秦统北方 → 淝水危局（引导新玩家）
    setTimeout(() => {
      const qin = D.chapters.find(c => c.id === 'qin-tong');
      if (qin) {
        chSel_proxy(qin);
      }
    }, 300);
  });

  function chSel_proxy(c) {
    // 模拟点击轨道上的秦统北方
    const blocks = document.querySelectorAll('.tl-chapter');
    for (const b of blocks) {
      if (b.textContent.includes('秦统北方')) { b.click(); break; }
    }
  }

  const $ = (s) => document.querySelector(s);
})();
