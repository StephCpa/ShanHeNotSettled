/* ═══════════════════════════════════════════════════════════
   十六国 · 山河未定 — 界面层
   页面清单（方案§04）：时代与剧本 / 天下与战区 / 城池详情 / 军团详情 /
   情报与军议 / 即时交锋 / 战报与史鉴
   关闭子界面返回原镜头、原选择与原筛选。
   ═══════════════════════════════════════════════════════════ */
window.SHL = window.SHL || {};

SHL.UI = (function () {
  'use strict';
  const D = SHL.DATA;
  const State = SHL.State;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ── 界面状态（进入子界面前的地图状态快照） ── */
  const ui = {
    selNode: null, selLegion: null, marchPending: null,
    lpTab: 'region', rpTab: 'intel', cityTab: 'population',
    savedCam: null,
  };

  /* ═══════════════ Toast ═══════════════ */
  function toast(msg, kind) {
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = msg;
    $('#toast-root').appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; }, 2600);
    setTimeout(() => t.remove(), 3100);
  }

  /* ═══════════════ 屏幕切换 ═══════════════ */
  function showScreen(name) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    $('#screen-' + name).classList.add('active');
    if (name === 'battle') SHL.Battle.resize();
  }

  /* ═══════════════ 时代与剧本选择 ═══════════════ */
  const chSel = { chapter: null, scenario: null, view: 'jin', mode: 'history' };
  const YEAR0 = 300, YEAR1 = 460;

  function buildChapterSelect() {
    // 标尺
    const ruler = $('#tl-ruler');
    ruler.innerHTML = '';
    for (let y = YEAR0; y <= YEAR1; y += 20) {
      const t = document.createElement('span');
      t.className = 'tl-tick';
      t.style.left = pctX(y) + '%';
      t.textContent = y + '年';
      ruler.appendChild(t);
    }
    // 轨道
    const tracks = {};
    D.chapters.forEach(c => { (tracks[c.track] = tracks[c.track] || []).push(c); });
    const box = $('#tl-tracks');
    box.innerHTML = '';
    Object.entries(tracks).forEach(([tid, arr]) => {
      const trackName = arr[0].trackName;
      const div = document.createElement('div');
      div.className = 'tl-track';
      div.innerHTML = `<div class="tl-track-label">${esc(trackName)}</div><div class="tl-track-lane"></div>`;
      const lane = div.querySelector('.tl-track-lane');
      arr.forEach(c => {
        const b = document.createElement('div');
        b.className = 'tl-chapter' + (c.later || (c.scenarios[0] && c.scenarios[0].locked) ? ' locked' : '');
        const fac = factionOfTrack(tid);
        b.style.background = fac ? fac.color : '#7A7E79';
        b.style.left = pctX(c.years[0]) + '%';
        b.style.width = Math.max(9, pctX(c.years[1]) - pctX(c.years[0])) + '%';
        b.innerHTML = `${esc(c.name)}<span class="years">${esc(c.yearLabel)}</span>`;
        b.addEventListener('click', () => {
          if (b.classList.contains('locked')) { toast('该篇章为后续补篇，尚未开放', 'info'); return; }
          SHL.Audio.tick();
          chSel.chapter = c;
          $$('.tl-chapter').forEach(x => x.classList.remove('selected'));
          b.classList.add('selected');
          renderChapterDetail();
        });
        lane.appendChild(b);
      });
      box.appendChild(div);
    });

    $('#btn-about').onclick = () => $('#modal-about').classList.remove('hidden');
    $('#about-close').onclick = () => $('#modal-about').classList.add('hidden');
  }
  function pctX(y) { return (y - YEAR0) / (YEAR1 - YEAR0) * 100; }
  function factionOfTrack(tid) {
    const map = { zhao: null, yan: D.factions.yan, qin: D.factions.qin, wei: D.factions.wei, jin: D.factions.jin, songwei: D.factions.song };
    return map[tid];
  }

  function renderChapterDetail() {
    const c = chSel.chapter;
    const box = $('#ch-detail');
    if (!c) return;
    const chars = c.chars.map(n => `<span class="cd-char"><b>${esc(n)}</b></span>`).join('');
    const scenarios = c.scenarios.map(s => {
      const locked = !!s.locked;
      return `<div class="cd-scen ${chSel.scenario === s.id ? 'selected' : ''}" data-sid="${s.id}">
        <h4>${esc(s.name)} <span class="year dim">${s.year}年</span>
          <span class="badge ${s.ext ? 'ext' : ''}">${esc(s.badge || '')}</span></h4>
        <p>${esc(s.desc)}${locked ? ' —— 未开放' : ''}</p>
      </div>`;
    }).join('');
    const playable = c.scenarios.find(s => s.playable);
    box.innerHTML = `
      <div class="cd-title">${esc(c.name)}</div>
      <div class="cd-years">${esc(c.yearLabel)} · 地域重心：${c.regions.map(r => esc(D.regions[r] ? D.regions[r].short : r)).join(' ')}</div>
      <div class="cd-tagline">${esc(c.tagline)}</div>
      <div class="cd-sec">内容篇章</div>
      ${scenarios}
      <div class="cd-sec">推荐人物</div>
      <div class="cd-chars">${chars}</div>
      <div class="cd-sec">学习重点</div>
      <p class="dim" style="font-size:13px">${esc(c.learn)}</p>
      ${playable ? `
      <div class="cd-sec">选择视角</div>
      <div class="cd-view-pick">
        <button class="btn ${chSel.view === 'jin' ? 'selected' : ''}" data-view="jin">东晋（推荐）</button>
        <button class="btn ${chSel.view === 'qin' ? 'selected' : ''}" data-view="qin">前秦</button>
      </div>
      <div class="cd-sec">模式</div>
      <div class="cd-mode-pick">
        <button class="btn ${chSel.mode === 'history' ? 'selected' : ''}" data-mode="history">历史剧本</button>
        <button class="btn ${chSel.mode === 'sandbox' ? 'selected' : ''}" data-mode="sandbox">自由推演</button>
      </div>
      <div class="cd-start-row">
        <button class="btn primary" id="btn-start" style="font-size:17px; padding:10px 34px; letter-spacing:4px">进入 383 · 淝水危局</button>
        <span class="dim">历史剧本采用明确初始局面；延续旧存档将保留已改变的历史</span>
      </div>` : '<p class="dim" style="margin-top:16px">该章节暂无可游玩切片，正在制作中。</p>'}
    `;
    box.querySelectorAll('.cd-scen').forEach(el => {
      el.addEventListener('click', () => {
        const s = c.scenarios.find(x => x.id === el.dataset.sid);
        if (s.locked) { toast('该剧本未开放', 'info'); return; }
        SHL.Audio.tick();
        chSel.scenario = s.id;
        renderChapterDetail();
      });
    });
    box.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { chSel.view = b.dataset.view; renderChapterDetail(); SHL.Audio.tick(); }));
    box.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { chSel.mode = b.dataset.mode; renderChapterDetail(); SHL.Audio.tick(); }));
    const start = $('#btn-start');
    if (start) start.addEventListener('click', () => {
      SHL.Audio.confirm();
      State.newGame(chSel.view);
      enterStrategy();
    });
  }

  /* ═══════════════ 进入战略界面 ═══════════════ */
  function enterStrategy() {
    showScreen('strategy');
    // 延迟切到战区（等渲染一帧）
    setTimeout(() => {
      SHL.Map3D.switchLevel('theater');
      SHL.Map3D.refreshLegions();
      SHL.Map3D.refreshIntel();
    }, 60);
    updateTopbar();
    renderLeftPanel();
    renderRightPanel();
    renderCommandBar();
    updateEndTurn();
    setBreadcrumb('theater');
  }

  /* ═══════════════ 顶栏 ═══════════════ */
  function updateTopbar() {
    const S = State.current();
    $('#tb-year').textContent = S.year + '年';
    $('#tb-season').textContent = State.SEASONS[S.seasonIdx];
    const f = D.factions[S.perspective];
    const fe = $('#tb-faction');
    fe.textContent = f.name;
    fe.className = 'fac-' + S.perspective;
    $('#tb-phase').textContent = S.phase === '结算' ? '结算中' : '筹划阶段';
    $('#tb-turn').textContent = '第' + S.turn + '回合';
    $('#res-grain-v').textContent = S.res.grain.toLocaleString();
    $('#res-gold-v').textContent = S.res.gold.toLocaleString();
    $('#res-troops-v').textContent = S.res.troops.toLocaleString();
    $('#res-todo-v').textContent = S.todos.length;
    // 资源悬停详情
    bindResDetail('res-grain', () => `
      <b>粮秣 ${S.res.grain.toLocaleString()} 石</b><br>
      本回合预计收入 +${S.resDetail.grainIn}（江南漕运）<br>
      本回合预计支出 −${S.resDetail.grainOut}（驻军口粮）<br>
      <span class="dim">${esc(S.resDetail.note)}</span>`);
    bindResDetail('res-gold', () => `<b>库帑 ${S.res.gold.toLocaleString()} 钱</b><br>市易与赏赐之源<br><span class="dim">秋赋将入库 +${S.resDetail.goldIn}</span>`);
    bindResDetail('res-troops', () => `<b>可用兵力 ${S.res.troops.toLocaleString()} 人</b><br>含北府各营与斥候轻骑<br><span class="dim">不含伤员与守辎重之卒</span>`);
    bindResDetail('res-todo', () => {
      if (!S.todos.length) return '<b>无待办</b>';
      return '<b>待办 ' + S.todos.length + ' 项</b><br>' + S.todos.map(t => `· ${esc(t.title)}`).join('<br>');
    });
  }
  function bindResDetail(id, htmlFn) {
    const el = document.getElementById(id);
    if (el._bound) return;
    el._bound = true;
    let pop = null;
    el.addEventListener('mouseenter', () => {
      pop = document.createElement('div');
      pop.className = 'res-detail';
      pop.innerHTML = htmlFn();
      el.appendChild(pop);
    });
    el.addEventListener('mouseleave', () => { if (pop) { pop.remove(); pop = null; } });
    el.addEventListener('focus', () => el.dispatchEvent(new Event('mouseenter')));
    el.addEventListener('blur', () => el.dispatchEvent(new Event('mouseleave')));
  }

  /* ═══════════════ 左栏 ═══════════════ */
  function renderLeftPanel() {
    const S = State.current();
    const body = $('#lp-body');
    $$('.lp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === ui.lpTab));
    if (ui.lpTab === 'region') {
      const T = D.theaterHuainan;
      const open = ui.lpTab === 'region';
      const groups = [
        { id: 'huainan', name: '淮南战区', open: true, fac: 'jin', items: Object.values(T.nodes).map(n => ({
          id: n.id, name: n.name, ico: icoOf(n.type), meta: metaOf(n.id, S), warn: warnOf(n.id, S) })) },
        { id: 'heluo', name: '河洛战区', open: false, fac: 'qin', items: [] },
        { id: 'jiangnan', name: '江南战区', open: false, fac: 'jin', items: [] },
      ];
      body.innerHTML = groups.map(g => `
        <div class="tree-region ${g.open ? 'open' : ''}" data-rg="${g.id}">
          <div class="tree-head">
            <span class="arrow">▶</span>
            <span class="fac-dot" style="background:${D.factions[g.fac].color}"></span>
            ${esc(g.name)}<span class="sum">${g.items.length ? g.items.length + '处' : '范围外'}</span>
          </div>
          <div class="tree-children">
            ${g.items.length ? g.items.map(i => `
              <div class="tree-item ${ui.selNode === i.id ? 'active' : ''}" data-node="${i.id}">
                <span class="ico">${i.ico}</span>${esc(i.name)}
                <span class="meta ${i.warn ? 'warnc' : ''}">${i.meta}</span>
              </div>`).join('')
            : '<div class="tree-item dim" style="cursor:default">剧本范围外 · 仅有贸易与外交摘要</div>'}
          </div>
        </div>`).join('');
      body.querySelectorAll('.tree-head').forEach(h => h.addEventListener('click', () => h.parentElement.classList.toggle('open')));
      body.querySelectorAll('.tree-item[data-node]').forEach(el => el.addEventListener('click', () => {
        pickNode(el.dataset.node);
      }));
    } else if (ui.lpTab === 'legion') {
      body.innerHTML = Object.values(S.legions).map(L => {
        const fac = D.factions[L.faction];
        const status = L.intel
          ? `<div class="lg-status warn">${esc(L.estimate)}</div>`
          : `<div class="lg-status ${L.fatigue > 50 ? 'warn' : ''}">士气${L.morale} · 疲劳${L.fatigue} · 粮支${L.supplyDays}日</div>`;
        return `<div class="lg-card ${ui.selLegion === L.id ? 'active' : ''}" data-legion="${L.id}">
          <h4><span class="lg-flag" style="background:${fac.color}"></span>${esc(L.name)}</h4>
          <div class="lg-meta"><span>${troopStr(L)}</span><span>${esc(nodeName(L.node))}</span></div>
          ${status}
        </div>`;
      }).join('');
      body.querySelectorAll('.lg-card').forEach(el => el.addEventListener('click', () => openLegion(el.dataset.legion)));
    } else {
      body.innerHTML = S.todos.length ? S.todos.map(t => `
        <div class="todo-item" data-anchor="${t.anchor || ''}">
          <b>${esc(t.title)}</b>
          <span class="t-kind">${kindName(t.kind)} · </span>${esc(t.desc)}
        </div>`).join('')
        : '<div class="dim" style="padding:30px 16px; text-align:center">诸事已毕 —— 可推进回合</div>';
      body.querySelectorAll('.todo-item').forEach(el => el.addEventListener('click', () => {
        if (el.dataset.anchor) pickNode(el.dataset.anchor);
      }));
    }
  }
  function icoOf(t) { return { city: '城', crossing: '渡', hill: '山', camp: '营', granary: '仓', road: '道', marsh: '泽', river: '涧' }[t] || '·'; }
  function metaOf(id, S) {
    if (id === 'dukou') return S.intel.dukou.state === 'confirmed' ? '敌三千' : S.intel.dukou.state === 'stale' ? '过时' : '待核';
    if (id === 'camp') return '驻军';
    if (id === 'granary') return S.res.grain.toLocaleString() + '石';
    if (id === 'shouyang') return '城';
    if (id === 'liangdao') return '粮道';
    return '';
  }
  function warnOf(id, S) { return id === 'dukou' && S.intel.dukou.state !== 'confirmed'; }
  function kindName(k) { return { intel: '侦报', transport: '运输', event: '事件', report: '战报', log: '军需' }[k] || k; }
  function nodeName(id) { const n = D.theaterHuainan.nodes[id]; return n ? n.name : id; }
  function troopStr(L) {
    if (L.intel) return '规模未辨';
    const t = L.infantry + L.cavalry + L.archer;
    return t.toLocaleString() + '人';
  }

  /* ═══════════════ 右栏 ═══════════════ */
  function renderRightPanel() {
    const S = State.current();
    $$('.rp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === ui.rpTab));
    const body = $('#rp-body');
    if (ui.rpTab === 'intel') {
      const I = S.intel.dukou;
      const stName = { unverified: '尚未核实', confirmed: '已核实', stale: '情报过时' };
      body.innerHTML = `
        <div class="intel-card ${I.state}">
          <h4>${esc(I.title)}<span class="i-state ${I.state}">${stName[I.state]}</span></h4>
          <div class="intel-kv">
            <div><b>地点</b>淝水西岸渡口</div>
            <div><b>记录</b>${esc(I.day)}</div>
            <div><b>内容</b>${esc(I.text)}</div>
            <div><b>可能影响</b>粮道中断</div>
          </div>
          <div class="intel-actions">
            <button class="btn" data-act="verify">交叉核实</button>
            <button class="btn" data-act="locate">定位地图</button>
            <button class="btn" data-act="stale" ${I.state === 'unverified' ? '' : 'disabled'}>标记过时</button>
          </div>
          <div class="intel-note">${I.state === 'unverified' ? '暂无确证 —— 界面显示「未收到回报」时，不推测敌情。' : I.state === 'stale' ? '记录日期已陈旧，请重新核实后再作判断。' : '来源：斥候乙队。多份同源传闻不构成独立证据。'}</div>
        </div>
        <div class="p-compare-note">情报四态：<span style="color:var(--shiqing)">已侦察</span> · <span style="color:var(--tu)">情报过时</span> · <span style="color:var(--ink-3)">尚未侦察</span> · 剧本范围外</div>
      `;
      body.querySelectorAll('.intel-actions .btn').forEach(b => b.addEventListener('click', () => {
        if (b.disabled) return;
        const act = b.dataset.act;
        if (act === 'locate') { pickNode('dukou'); }
        if (act === 'verify') { ui.rpTab = 'council'; renderRightPanel(); openCouncil(); }
        if (act === 'stale') { S.intel.dukou.state = 'stale'; S.intel.dukou.day = '二日前（情报过时）'; renderRightPanel(); toast('已标记为过时情报', 'info'); }
      }));
      // 方案预览卡（若军议已选）
      if (S.councilChosen) {
        const p = D.council.proposals.find(x => x.id === S.councilChosen);
        body.innerHTML += `
          <div class="proposal selected">
            <h4>已拟军令 · 方案${esc(p.id)} ${esc(p.name)}<span class="p-kind">${esc(p.kind)}</span></h4>
            <div class="p-row"><b>预览</b>${esc(p.preview)}</div>
          </div>`;
      }
    } else if (ui.rpTab === 'council') {
      const ch = D.council;
      body.innerHTML = `
        <div class="council-intro">军议由可核验的游戏状态支撑；<span class="ai-mark">AI研判</span>与<span class="fact-mark">事实</span>分列显示。</div>
        <div class="evidence-block">
          <b>「${esc(ch.evidence.content)}」</b>
          <div class="ev-meta">来源 ${esc(ch.evidence.source)} · 观察${esc(ch.evidence.observed)} · 收到${esc(ch.evidence.received)} · 地点${esc(ch.evidence.place)}</div>
        </div>
        ${ch.councilors.map(c => {
          const chr = D.characters[c.char];
          if (c.dead) return `<div class="councilor dead"><div class="c-ava">${esc(chr.name[0])}</div>
            <div><h5>${esc(chr.name)} · ${esc(c.role)}</h5><div class="c-view">${esc(c.deadNote)}</div></div></div>`;
          return `<div class="councilor"><div class="c-ava">${esc(chr.name[0])}</div>
            <div><h5>${esc(chr.name)} <span class="c-role">${esc(c.role)}</span></h5>
            <div class="c-view">${c.view}</div>
            <div class="c-view dim">偏好：${esc(c.bias)}</div></div></div>`;
        }).join('')}
        <div class="intel-note">${esc(ch.evidence.aiNote)}<br>${esc(ch.evidence.sameOriginNote)}</div>
        <button class="btn primary" id="rp-open-council" style="width:100%; justify-content:center; margin-top:8px">进入军议 · 比较三案</button>
      `;
      $('#rp-open-council').addEventListener('click', openCouncil);
    } else {
      const S2 = State.current();
      body.innerHTML = `
        <div class="intel-card">
          <h4>军需账目</h4>
          <div class="intel-kv">
            <div><b>存粮</b>${S2.res.grain.toLocaleString()} 石（石仓九千二百石已入账）</div>
            <div><b>库帑</b>${S2.res.gold.toLocaleString()} 钱</div>
            <div><b>运输队</b>2队 · 道路${esc(D.cityShouyang.roadState)}</div>
          </div>
        </div>
        ${S2.log.map(l => `<div class="log-item"><span class="l-turn">${esc(l.turn)}</span>${esc(l.text)}</div>`).join('')}
      `;
    }
  }

  /* ═══════════════ 底部命令栏 ═══════════════ */
  function renderCommandBar() {
    const S = State.current();
    const ctx = $('#cb-context'), btns = $('#cb-btns'), note = $('#cb-note');
    cancelMarchPending();
    if (ui.selLegion) {
      const L = S.legions[ui.selLegion];
      if (!L) { ui.selLegion = null; renderCommandBar(); return; }
      ctx.innerHTML = `已选军团 <b>${esc(L.name)}</b><span class="dim">${troopStr(L)} · ${esc(nodeName(L.node))} · 态势「${State.stanceName(L.stance)}」${L.intel ? ' · 敌情估计，不可直接下令' : ''}</span>`;
      const canOrder = !L.intel;
      btns.innerHTML = `
        <button class="btn" data-cmd="march" ${canOrder ? '' : 'disabled'}>行军<span class="b-key">选目标</span></button>
        <button class="btn" data-cmd="scout" ${L.scout ? 'disabled' : canOrder ? '' : 'disabled'}>侦察<span class="b-key">派往渡口</span></button>
        <button class="btn" data-cmd="camp">扎营</button>
        <button class="btn" data-cmd="escort" ${L.transport ? 'disabled' : canOrder ? '' : 'disabled'}>护粮</button>
        <button class="btn" data-cmd="retreat">撤退</button>
        <button class="btn" data-cmd="delegate">委任</button>`;
      note.innerHTML = canOrder
        ? '行军需先点「行军」，再点击地图目标节点；下令前可撤销。'
        : '该单位为敌方情报单位，仅显示估计，无法下令。';
      btns.querySelectorAll('.btn').forEach(b => b.addEventListener('click', () => legionCmd(b.dataset.cmd)));
    } else if (ui.selNode) {
      const n = D.theaterHuainan.nodes[ui.selNode];
      ctx.innerHTML = `已选 <b>${esc(n.name)}</b><span class="dim">${esc(n.desc)}</span>`;
      if (n.type === 'city') {
        btns.innerHTML = `
          <button class="btn" data-cmd="recruit">征募</button>
          <button class="btn" data-cmd="build">修筑</button>
          <button class="btn" data-cmd="settle">安置</button>
          <button class="btn" data-cmd="grant">调拨</button>
          <button class="btn" data-cmd="detail">城池详情</button>`;
        note.textContent = '征募、修筑等事务在城池详情中下令；此处为高频入口。';
        btns.querySelectorAll('.btn').forEach(b => b.addEventListener('click', () => {
          const map = { recruit: 'recruit', build: 'defense', settle: 'population', grant: 'granary', detail: 'population' };
          openCity('shouyang', map[b.dataset.cmd] || 'population');
        }));
      } else if (n.type === 'granary' || n.type === 'road') {
        btns.innerHTML = `
          <button class="btn" data-cmd="escort">护粮</button>
          <button class="btn" data-cmd="transfer">调拨</button>
          <button class="btn" data-cmd="detail">军需账目</button>`;
        note.textContent = '粮道节点：护送与调拨命令将进入队列。';
        btns.querySelectorAll('.btn').forEach(b => b.addEventListener('click', () => {
          if (b.dataset.cmd === 'detail') { ui.rpTab = 'log'; renderRightPanel(); }
          else if (b.dataset.cmd === 'escort') { ui.selLegion = 'beifu'; renderCommandBar(); }
          else toast('调拨：石仓粮囤可支至冬初，暂无短绌。', 'info');
        }));
      } else {
        btns.innerHTML = `
          <button class="btn" data-cmd="scout">侦察</button>
          <button class="btn" data-cmd="watch">瞭望</button>
          <button class="btn" data-cmd="camp">扎营</button>`;
        note.textContent = esc(n.desc);
        btns.querySelectorAll('.btn').forEach(b => b.addEventListener('click', () => {
          const cmd = b.dataset.cmd;
          if (cmd === 'scout') { ui.selLegion = 'scouts'; renderCommandBar(); toast('已选斥候乙队 —— 点「侦察」派往渡口', 'info'); }
          else toast('已下令，进入待执行队列。', 'good');
        }));
      }
    } else {
      ctx.innerHTML = '未选中对象 —— 点击地图中的城池或军团';
      btns.innerHTML = `
        <button class="btn" data-cmd="scout">侦察</button>
        <button class="btn" data-cmd="army">调军</button>
        <button class="btn" data-cmd="supply">补给</button>
        <button class="btn" data-cmd="diplomacy" disabled>外交<span class="reason">剧本范围内暂无外交对象</span></button>`;
      note.textContent = '每次最多显示六个高频动作；随城池、军团、地形选择变化。';
      btns.querySelectorAll('.btn').forEach(b => b.addEventListener('click', () => {
        const c = b.dataset.cmd;
        if (c === 'scout') { ui.selLegion = 'scouts'; renderCommandBar(); }
        if (c === 'army') { ui.lpTab = 'legion'; renderLeftPanel(); }
        if (c === 'supply') { ui.rpTab = 'log'; renderRightPanel(); }
      }));
    }
  }

  function legionCmd(cmd) {
    const S = State.current();
    const L = S.legions[ui.selLegion];
    if (!L) return;
    if (cmd === 'march' || cmd === 'escort') {
      ui.marchPending = { legionId: L.id, kind: cmd === 'escort' ? 'escort' : 'march' };
      $('#cb-note').innerHTML = `<b style="color:var(--zhusha)">行军预览：</b>请在地图上点击目标节点（${esc(L.name)} 从 ${esc(nodeName(L.node))} 出发）`;
      toast('请点击目标节点', 'info');
      return;
    }
    if (cmd === 'scout') {
      if (L.scout) {
        State.addOrder({ kind: 'scout', legionId: L.id, label: L.name, grain: 20, turns: 1,
          from: L.node, to: 'dukou', fromName: nodeName(L.node), toName: '渡口',
          path: bfsPath(L.node, 'dukou'), desc: '核实渡口敌情' });
        SHL.Audio.confirm();
        toast('斥候已派出 —— 推进回合后带回核实情报', 'good');
        SHL.Map3D.drawMarchArrow(L.id, bfsPath(L.node, 'dukou'), 0x657C82);
        updateEndTurn();
      }
      return;
    }
    if (cmd === 'delegate') { openLegion(L.id, 'delegate'); return; }
    if (cmd === 'camp') { toast(L.name + ' 就地扎营 —— 疲劳将缓慢恢复', 'good'); SHL.Audio.confirm(); return; }
    if (cmd === 'retreat') { toast(L.name + ' 已下令向后方脱离（进入队列）', 'good'); SHL.Audio.confirm(); return; }
  }

  /* 路径：BFS 最短道路 */
  function bfsPath(from, to) {
    const T = D.theaterHuainan;
    if (from === to) return [from];
    const adj = {};
    T.roads.forEach(([a, b]) => { (adj[a] = adj[a] || []).push(b); (adj[b] = adj[b] || []).push(a); });
    const prev = {}, q = [from], seen = new Set([from]);
    while (q.length) {
      const cur = q.shift();
      if (cur === to) break;
      (adj[cur] || []).forEach(nx => {
        if (!seen.has(nx)) { seen.add(nx); prev[nx] = cur; q.push(nx); }
      });
    }
    if (!seen.has(to)) return [from, to];
    const path = [to];
    let c = to;
    while (c !== from) { c = prev[c]; path.unshift(c); }
    return path;
  }

  /* 行军预览浮窗 */
  function showMarchPreview(targetNode) {
    const S = State.current();
    const mp = ui.marchPending;
    if (!mp) return;
    const L = S.legions[mp.legionId];
    const path = bfsPath(L.node, targetNode);
    const hops = path.length - 1;
    const step = L.stance === 'fast' ? 2 : 1;
    const turns = Math.max(1, Math.ceil(hops / step));
    const men = L.infantry + L.cavalry + L.archer;
    const grain = turns * Math.round(men / 40);
    // 未知路段：路径含渡口且情报未核实
    const unknown = path.includes('dukou') && S.intel.dukou.state !== 'confirmed';
    const panel = document.createElement('div');
    panel.id = 'march-preview-float';
    panel.style.cssText = 'position:absolute;left:50%;bottom:150px;transform:translateX(-50%);z-index:15;background:var(--paper);border:1px solid var(--line);border-radius:3px;box-shadow:var(--shadow);padding:14px 18px;font-size:13.5px;line-height:1.9;min-width:380px';
    panel.innerHTML = `
      <b style="font-family:var(--f-title);font-size:16px;letter-spacing:2px">行军预览 · ${esc(L.name)}</b><br>
      路线：${path.map(nodeName).join(' → ')}<br>
      预计 <b>${turns} 回合</b> · 粮耗约 <b>${grain}</b> 石${unknown ? ' · <span class="warn" style="color:var(--zhusha)">路径含未探明路段（渡口情报未核实）</span>' : ''}<br>
      态势「${State.stanceName(L.stance)}」· 可在军团详情中调整快行/稳行/避敌
      <div style="display:flex;gap:10px;margin-top:8px">
        <button class="btn primary" id="mp-confirm">下令</button>
        <button class="btn" id="mp-cancel">取消</button>
        <span class="dim" style="align-self:center">点「下令」才加入待执行队列</span>
      </div>`;
    $('#map-wrap').appendChild(panel);
    SHL.Map3D.drawMarchArrow(L.id, path, mp.kind === 'escort' ? 0x9C8665 : 0x984C3F);
    $('#mp-confirm').addEventListener('click', () => {
      State.addOrder({
        kind: mp.kind, legionId: L.id, label: L.name,
        from: L.node, to: targetNode, fromName: nodeName(L.node), toName: nodeName(targetNode),
        path, turns, grain, desc: (mp.kind === 'escort' ? '护送' : '行军') + '至' + nodeName(targetNode),
      });
      SHL.Audio.confirm();
      toast(`军令已入队：${L.name} → ${nodeName(targetNode)}（${turns}回合）`, 'good');
      cancelMarchPending(true);
      updateEndTurn();
      renderLeftPanel();
    });
    $('#mp-cancel').addEventListener('click', () => { cancelMarchPending(true); });
  }
  function cancelMarchPending(keepArrow) {
    ui.marchPending = null;
    const p = $('#march-preview-float');
    if (p) p.remove();
    if (!keepArrow) SHL.Map3D.clearMarchArrows();
  }

  /* ═══════════════ 节点/军团选择 ═══════════════ */
  function pickNode(id) {
    const T = D.theaterHuainan;
    if (!T.nodes[id]) return;
    ui.selNode = id; ui.selLegion = null;
    if (SHL.Map3D.getLevel() === 'world') SHL.Map3D.switchLevel('theater', { focus: id });
    else SHL.Map3D.focusNode(id);
    setBreadcrumb('site', id);
    renderLeftPanel(); renderCommandBar();
    setSiteBreadcrumb(id);
    // 行军待选状态：选择即为目标
    if (ui.marchPending) showMarchPreview(id);
  }
  function setSiteBreadcrumb(id) {
    const n = D.theaterHuainan.nodes[id];
    const crumb = document.querySelector('.crumb[data-level="site"]');
    if (n) crumb.textContent = n.name;
  }
  function setBreadcrumb(levelName) {
    $$('.crumb').forEach(c => {
      const lv = c.dataset.level;
      c.classList.toggle('on', lv === levelName || (levelName === 'site' && lv === 'theater'));
    });
  }

  /* ═══════════════ 推进回合 ═══════════════ */
  function updateEndTurn() {
    const S = State.current();
    const issues = State.blockingIssues();
    const btn = $('#end-turn');
    btn.classList.toggle('blocked', issues.length > 0);
    $('#et-sub').textContent = issues.length ? '有阻塞问题待处理' : (S.queue.length ? `待执行军令 ${S.queue.length} 条` : '先检查待处理军令');
  }
  function bindEndTurn() {
    const btn = $('#end-turn');
    btn.addEventListener('mouseenter', () => {
      const S = State.current();
      const issues = State.blockingIssues();
      const warns = State.softWarnings();
      const pv = $('#et-preview');
      pv.innerHTML = `
        <b>执行预览</b><br>
        ${S.queue.length ? S.queue.map(q => `· ${esc(q.label || '')} → ${esc(q.toName || '')}（${q.turns}回合，粮${q.grain}）`).join('<br>') + '<br>' : '（暂无待执行军令）<br>'}
        ${issues.length ? '<span class="warn">阻塞：' + issues.map(esc).join('；') + '</span><br>' : ''}
        ${warns.length ? '<span class="dim">提示：' + warns.map(esc).join('；') + '</span>' : ''}
      `;
      pv.classList.remove('hidden');
    });
    btn.addEventListener('mouseleave', () => $('#et-preview').classList.add('hidden'));
    btn.addEventListener('click', () => {
      const S = State.current();
      const issues = State.blockingIssues();
      if (issues.length) { toast(issues[0], ''); SHL.Audio.alert(); return; }
      const r = State.endTurn();
      if (!r.ok) { toast(r.reason || '无法推进', ''); return; }
      showSettle(r);
    });
  }

  function showSettle(r) {
    const ov = $('#settle-overlay');
    const log = $('#settle-log');
    const S = State.current();
    $('#settle-turn').textContent = `第${S.turn}回合 · ${State.SEASONS[S.seasonIdx]}`;
    log.innerHTML = '';
    ov.classList.remove('hidden');
    let i = 0;
    const timer = setInterval(() => {
      if (i >= r.lines.length) { clearInterval(timer); return; }
      const l = r.lines[i++];
      const div = document.createElement('div');
      div.className = 'sl-line ' + (l.cls || '');
      div.textContent = `[${l.t}] ${l.text}`;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }, 420);
    $('#settle-skip').onclick = () => {
      clearInterval(timer);
      log.innerHTML = r.lines.map(l => `<div class="sl-line ${l.cls || ''}" style="animation:none;opacity:1;transform:none">[${l.t}] ${esc(l.text)}</div>`).join('');
    };
    $('#settle-done').onclick = () => {
      SHL.Audio.turn();
      ov.classList.add('hidden');
      updateTopbar(); renderLeftPanel(); renderRightPanel(); renderCommandBar(); updateEndTurn();
      SHL.Map3D.refreshLegions(); SHL.Map3D.refreshIntel();
      SHL.Map3D.clearMarchArrows();
      if (r.battleTrigger) {
        setTimeout(promptBattle, 250);
      }
    };
  }

  /* ═══════════════ 交锋提示 ═══════════════ */
  function promptBattle() {
    SHL.Audio.alert();
    const mask = document.createElement('div');
    mask.className = 'ov-mask';
    mask.innerHTML = `
      <div class="ov-card" style="width:520px; padding:26px 30px">
        <h3 style="font-family:var(--f-title);font-size:24px;letter-spacing:4px;margin-bottom:10px">渡口 · 关键交锋</h3>
        <p style="font-size:14px;line-height:2">秦军前锋扑向渡口粮道。是否<b style="color:var(--zhusha)">亲自指挥</b>？</p>
        <p class="dim" style="font-size:13px;line-height:1.9">亲自指挥：以${esc(D.battleDukou.commanderName)}视角调度六个单位（2—5分钟）。<br>
        委任：交由现场将领按预案处理，仍按同一战斗模型结算。</p>
        <div style="display:flex;gap:12px;margin-top:18px">
          <button class="btn primary" id="pb-live" style="flex:1;justify-content:center">亲自指挥</button>
          <button class="btn" id="pb-deleg" style="flex:1;justify-content:center">委任将领</button>
        </div>
      </div>`;
    document.body.appendChild(mask);
    mask.querySelector('#pb-live').addEventListener('click', () => {
      mask.remove();
      startBattle(false);
    });
    mask.querySelector('#pb-deleg').addEventListener('click', () => {
      mask.remove();
      startBattle(true);
    });
  }

  function startBattle(delegated) {
    if (delegated) {
      // 委任：同一战斗模型快速结算（确定性伪随机）
      const seed = D.battleDukou.seed;
      const rnd = mulberry(seed);
      const win = rnd() > 0.28;
      const losses = { player: win ? 240 + Math.round(rnd() * 260) : 480 + Math.round(rnd() * 400), enemy: win ? 500 + Math.round(rnd() * 500) : 260 + Math.round(rnd() * 300) };
      const convoyHp = win ? 0.55 + rnd() * 0.45 : 0.15 + rnd() * 0.4;
      const result = {
        win, text: win ? '都督按预案护粮强渡，粮车未失。' : '敌锋锐利，护送失利，弃车而还。',
        losses, convoyHp, wounded: Math.round(losses.player * 0.3), time: 0,
        assumptions: [
          { k: '「敌约三千，无浮桥」', ok: true, note: '与核实情报相符' },
          { k: '「浅滩可快速通过」', ok: convoyHp > 0.5, note: convoyHp > 0.5 ? '浅滩通过顺利' : '浅滩受阻，辎重损失过半' },
          { k: '「林缘可覆盖渡口」', ok: win, note: win ? '弩手保持东岸位' : '交战过烈，火力中断' },
        ],
        delegated: true,
      };
      State.writeBattleResult(result);
      openReport(result);
      return;
    }
    showScreen('battle');
    SHL.Battle.start({
      onResult: (result) => {
        State.writeBattleResult(result);
        showScreen('strategy');
        openReport(result);
      },
    });
  }
  function mulberry(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ═══════════════ 城池详情 ═══════════════ */
  let citySceneHandle = null;
  function openCity(id, tab) {
    const C = D.cityShouyang;
    const S = State.current();
    const mask = document.createElement('div');
    mask.className = 'ov-mask'; mask.id = 'ov-city';
    mask.innerHTML = `
      <div class="ov-card">
        <div class="ov-backnote">关闭返回城池位置</div>
        <button class="ov-close">✕</button>
        <div class="city-3d">
          <div class="c3d-title">寿阳 <span class="sub">点选城门 · 粮仓 · 集市 · 营地进入对应事务</span></div>
          <canvas></canvas>
          <div class="c3d-hint">拖动旋转 · 滚轮缩放</div>
        </div>
        <div class="city-panel">
          <div class="city-tabs">
            <button data-ct="population">人口与安置</button>
            <button data-ct="granary">粮库与转运</button>
            <button data-ct="recruit">征募与整编</button>
            <button data-ct="defense">防御与修筑</button>
            <button data-ct="deleg">委任与地方</button>
          </div>
          <div class="city-content" id="city-content"></div>
        </div>
      </div>`;
    document.body.appendChild(mask);
    const canvas = mask.querySelector('canvas');
    citySceneHandle = SHL.Map3D.createCityScene(canvas, (hot) => {
      const map = { gate: 'defense', granary: 'granary', market: 'population', camp: 'recruit' };
      setCityTab(map[hot] || 'population');
    });
    mask.querySelector('.ov-close').addEventListener('click', closeCity);
    mask.addEventListener('click', (e) => { if (e.target === mask) closeCity(); });
    mask.querySelectorAll('.city-tabs button').forEach(b => b.addEventListener('click', () => setCityTab(b.dataset.ct)));
    setCityTab(tab || 'population');

    function setCityTab(t) {
      ui.cityTab = t;
      mask.querySelectorAll('.city-tabs button').forEach(b => b.classList.toggle('active', b.dataset.ct === t));
      const box = mask.querySelector('#city-content');
      const pv = (s) => `<td class="preview-col">${s}</td>`;
      const tables = {
        population: `
          <h3>人口与安置</h3>
          <table class="kv-table">
            <tr><th>居民</th><td><b>${C.population.toLocaleString()}</b></td>${pv('治安平稳')}</tr>
            <tr><th>流民</th><td><b class="num-neg">${C.refugees.toLocaleString()}</b> 待安置</td>${pv('再纳2,000人：粮耗+80/回合，治安−3')}</tr>
            <tr><th>容纳量</th><td><b>${C.capacity.toLocaleString()}</b></td>${pv('扩营后 +8,000')}</tr>
            <tr><th>治安</th><td><b>71</b> 安</td>${pv('流民未安置：每回合 −2')}</tr>
          </table>
          <div class="act-row">
            <button class="btn primary" data-a="settle">安置流民（2,000人）</button>
            <button class="btn" data-a="census">检视户口</button>
            <span class="dim">下令前预览列显示粮耗、住房压力与征募影响；资源不足不必退出本页。</span>
          </div>`,
        granary: `
          <h3>粮库与转运</h3>
          <table class="kv-table">
            <tr><th>存粮</th><td><b>${C.grain.toLocaleString()}</b> 石</td>${pv('可支撑全州约9回合')}</tr>
            <tr><th>收支</th><td>入 <b class="num-pos">+${C.grainIn}</b> / 出 <b class="num-neg">−${C.grainOut}</b> 每回合</td>${pv('漕运若断：入−200')}</tr>
            <tr><th>运输队</th><td><b>${C.transportTeams}</b> 队 · 道路${C.roadState}</td>${pv('秋雨：转运时间+1回合')}</tr>
            <tr><th>截断风险</th><td><b class="num-neg">渡口若失 · 高</b></td>${pv('护粮后降至低')}</tr>
          </table>
          <div class="act-row">
            <button class="btn primary" data-a="transfer">调拨 1,000石 至东岸大营</button>
            <span class="dim">预览：运输时间1回合 · 需1队护送 · 截断风险随行军变化。</span>
          </div>`,
        recruit: `
          <h3>征募与整编</h3>
          <table class="kv-table">
            <tr><th>兵源</th><td><b>${C.conscripts.toLocaleString()}</b> 可征</td>${pv('征募500：人口抽离，粮耗+60/回合')}</tr>
            <tr><th>装备</th><td><b>${C.gear}</b></td>${pv('补足需 库帑800')}</tr>
            <tr><th>马匹</th><td><b>${C.horses}</b> 匹</td>${pv('代北马未通商，暂缺')}</tr>
            <tr><th>训练队列</th><td>${C.trainingQueue.map(q => `${esc(q.name)} ×${q.count}（余${q.turns}回合）`).join('、')}</td>${pv('完成后北府兵+500')}</tr>
          </table>
          <div class="act-row">
            <button class="btn primary" data-a="train">征募北府新卒 500</button>
            <span class="dim">预览：2回合成军 · 粮耗+60/回合 · 人口抽离400。</span>
          </div>`,
        defense: `
          <h3>防御与修筑</h3>
          <table class="kv-table">
            <tr><th>城防</th><td><b>${C.wallLevel}</b></td>${pv(' 东垣修复后 +1档')}</tr>
            <tr><th>损坏</th><td><b>${C.wallDamage}</b></td>${pv('修复需2回合')}</tr>
            <tr><th>工程人力</th><td><b>${C.engineers}</b> 人</td>${pv('另需征民夫300，扰动农事')}</tr>
            <tr><th>供给负担</th><td>口粮 −40/回合</td>${pv('秋收后减轻')}</tr>
          </table>
          <div class="act-row">
            <button class="btn primary" data-a="repair">修葺东垣</button>
            <span class="dim">预览：2回合 · 扰动范围：东郊农田 · 供给−40/回合。</span>
          </div>`,
        deleg: `
          <h3>委任与地方关系</h3>
          <table class="kv-table">
            <tr><th>主官</th><td><b>${esc(C.magistrate)}</b></td>${pv('权限：征调本城民夫与存粮三成')}</tr>
            <tr><th>士族</th><td>${esc(C.gentry)}</td>${pv('承诺兑现则粮赋+10%')}</tr>
            <tr><th>部曲</th><td><b>800</b> 私兵（不在可用兵力内）</td>${pv('撤换主官需 库帑1,000')}</tr>
            <tr><th>地方承诺</th><td>${esc(C.pledges)}</td>${pv('护粮成功可兑现')}</tr>
          </table>
          <div class="act-row">
            <button class="btn" data-a="pledge">增派护粮（兑现承诺）</button>
            <span class="dim">委任边界可检查：主官将在授权内自行处理日常事务。</span>
          </div>`,
      };
      box.innerHTML = tables[t];
      box.querySelectorAll('.act-row .btn').forEach(b => b.addEventListener('click', () => {
        SHL.Audio.confirm();
        toast('已下令 —— 变化将以数字与队列呈现（原型演示）', 'good');
      }));
    }
  }
  function closeCity() {
    if (citySceneHandle) { citySceneHandle.dispose(); citySceneHandle = null; }
    const m = $('#ov-city');
    if (m) m.remove();
  }

  /* ═══════════════ 军团详情 ═══════════════ */
  let legionSceneHandle = null;
  function openLegion(id, tab) {
    const S = State.current();
    const L = S.legions[id];
    if (!L) return;
    ui.selLegion = id;
    renderCommandBar(); renderLeftPanel();
    const chr = L.general ? D.characters[L.general] : null;
    const cmdr = L.commander ? D.characters[L.commander] : null;
    const mask = document.createElement('div');
    mask.className = 'ov-mask'; mask.id = 'ov-legion';
    mask.innerHTML = `
      <div class="ov-card">
        <div class="ov-backnote">关闭返回军团位置</div>
        <button class="ov-close">✕</button>
        <div class="lg-layout">
          <div class="lg-left">
            <h3>${esc(L.name)}</h3>
            ${chr ? `
            <div class="lg-gen">
              <div class="g-ava">${esc(chr.name[0])}</div>
              <div><h4>${esc(chr.name)}</h4><div class="g-title">${L.scout ? '斥候主官' : L.transport ? '辎重都尉' : '统军 · 都督'}${cmdr ? ' · 受' + esc(cmdr.name) + '节制' : ''}</div></div>
            </div>` : '<p class="dim" style="margin-bottom:12px">无主将 —— 由都督府遥领</p>'}
            <div class="lg-stat">
              <div>总兵力 <b>${troopStr(L)}</b>${L.intel ? ' <span class="ai-mark">估计</span>' : ' <span class="fact-mark">本部可见</span>'}</div>
              ${L.intel ? `<div class="dim" style="line-height:1.8">${esc(L.estimate)}<br>${esc(L.note)}</div>` : `
              <div>步卒 <b>${L.infantry.toLocaleString()}</b> · 甲骑 <b>${L.cavalry.toLocaleString()}</b> · 强弩 <b>${L.archer.toLocaleString()}</b></div>
              <div>士气 <b>${L.morale}</b><span class="bar bar-morale"><i style="width:${L.morale}%"></i></span></div>
              <div>疲劳 <b>${L.fatigue}</b><span class="bar bar-fatigue"><i style="width:${L.fatigue}%"></i></span></div>
              <div>粮秣可支撑 <b>${L.supplyDays}</b> 日<span class="bar bar-supply"><i style="width:${Math.min(100, L.supplyDays / 40 * 100)}%"></i></span></div>
              <div class="dim" style="font-size:12px;margin-top:6px">${esc(L.note)}</div>`}
            </div>
            <div class="deleg-box">
              <b style="letter-spacing:2px">委任边界</b>
              <div class="d-row"><span>任务目标</span><span>护道 / 待命</span></div>
              <div class="d-row"><span>活动地域</span><span>淮南东岸</span></div>
              <div class="d-row"><span>最大可用兵力</span><span>六成</span></div>
              <div class="d-row"><span>补给额度</span><span>日支${Math.round((L.infantry + L.cavalry + L.archer) / 40)}石</span></div>
              <div class="d-row"><span>撤退条件</span><span>伤亡三成或粮尽</span></div>
              <div class="dim" style="margin-top:6px;font-size:11.5px">越界行动将报告事实与原因；违令可追溯。</div>
              <button class="btn" id="lg-editdeleg" style="margin-top:8px;width:100%;justify-content:center">修改授权</button>
            </div>
          </div>
          <div class="lg-mid">
            <div class="lg-scene"><canvas></canvas><div class="hint">可旋转的军阵缩景 —— 拖动旋转 · 滚轮缩放</div></div>
          </div>
          <div class="lg-right">
            <h3>任务与行军</h3>
            <div style="font-size:13px;color:var(--ink-dim);margin-bottom:4px">行军态势（拖动路线可比较三案）</div>
            <div class="march-mode">
              <button class="btn ${L.stance === 'fast' ? 'selected' : ''}" data-st="fast">快行</button>
              <button class="btn ${L.stance === 'steady' ? 'selected' : ''}" data-st="steady">稳行</button>
              <button class="btn ${L.stance === 'avoid' ? 'selected' : ''}" data-st="avoid">避敌</button>
            </div>
            <div class="march-preview" id="lg-mpreview"></div>
            <h3>执行中的军令</h3>
            <div id="lg-orders" style="font-size:13px;line-height:2"></div>
            <h3 style="margin-top:12px">风险</h3>
            <div style="font-size:13px;line-height:1.9" id="lg-risks"></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(mask);
    const scene = SHL.Map3D.createLegionScene(mask.querySelector('canvas'), L);
    legionSceneHandle = scene;
    mask.querySelector('.ov-close').addEventListener('click', closeLegion);
    mask.addEventListener('click', (e) => { if (e.target === mask) closeLegion(); });

    function refreshSide() {
      const L2 = S.legions[id];
      const mpv = $('#lg-mpreview');
      const step = L2.stance === 'fast' ? 2 : 1;
      const men = L2.infantry + L2.cavalry + L2.archer;
      const extra = L2.stance === 'fast' ? '损耗+ · 侦察范围−' : L2.stance === 'avoid' ? '接敌概率− · 时长+' : '均衡';
      mpv.innerHTML = `以当前态势前往渡口：预计 <b>${Math.max(1, Math.ceil(2 / step))} 回合</b> · 粮耗约 <b>${Math.max(1, Math.ceil(2 / step)) * Math.round(men / 40)}</b> 石<br>
        <span class="dim">${extra}；预览将时间、损耗与侦察范围一起更新。</span>`;
      const orders = State.ordersOfLegion(id);
      $('#lg-orders').innerHTML = orders.length
        ? orders.map(o => `· ${esc(o.kind === 'escort' ? '护送' : o.kind === 'scout' ? '侦察' : '行军')} → ${esc(o.toName || '')}（${o.turns}回合）<br>`).join('')
        : '<span class="dim">暂无 —— 关闭后可在地图上右键目标预览行军。</span>';
      const risks = [];
      if (L2.fatigue > 40) risks.push('疲劳偏高，持续作战能力下降');
      if (L2.supplyDays < 12) risks.push('粮秣可支撑日数偏低');
      if (S.intel.dukou.state !== 'confirmed' && id !== 'scouts') risks.push('渡口情报未核实，临敌决策风险高');
      $('#lg-risks').innerHTML = risks.length ? risks.map(r => '· ' + esc(r)).join('<br>') : '<span class="dim">暂无明显风险</span>';
      mask.querySelectorAll('.march-mode .btn').forEach(b => b.classList.toggle('selected', b.dataset.st === L2.stance));
    }
    refreshSide();
    mask.querySelectorAll('.march-mode .btn').forEach(b => b.addEventListener('click', () => {
      L.stance = b.dataset.st;
      SHL.Audio.tick();
      refreshSide();
    }));
    $('#lg-editdeleg').addEventListener('click', () => toast('授权边界已记录 —— 将领越界时将报告原因（原型演示）', 'info'));
  }
  function closeLegion() {
    if (legionSceneHandle) { legionSceneHandle.dispose(); legionSceneHandle = null; }
    const m = $('#ov-legion');
    if (m) m.remove();
  }

  /* ═══════════════ 军议 ═══════════════ */
  let councilProposal = null;
  function openCouncil() {
    const S = State.current();
    const ch = D.council;
    councilProposal = S.councilChosen || null;
    const mask = document.createElement('div');
    mask.className = 'ov-mask'; mask.id = 'ov-council';
    mask.innerHTML = `
      <div class="ov-card">
        <div class="ov-backnote">关闭保留方案标记，返回原地图状态</div>
        <button class="ov-close">✕</button>
        <div class="council-layout">
          <div class="council-left">
            <h3>侦报证据</h3>
            <div class="evidence-block">
              <b>「${esc(ch.evidence.content)}」</b>
              <div class="ev-meta">来源 ${esc(ch.evidence.source)} · 观察 ${esc(ch.evidence.observed)} · 收到 ${esc(ch.evidence.received)}<br>地点 ${esc(ch.evidence.place)}</div>
            </div>
            <div class="intel-note">判断：${esc(ch.evidence.judgement)}<br>可能影响：${esc(ch.evidence.impact)}</div>
            <div style="display:flex;gap:8px;margin:10px 0 16px">
              <button class="btn" id="cv-locate">定位地图</button>
              <button class="btn" id="cv-track">追踪来源</button>
            </div>
            <h3>局势判断</h3>
            ${ch.councilors.filter(c => !c.dead).map(c => {
              const chr = D.characters[c.char];
              return `<div class="councilor"><div class="c-ava">${esc(chr.name[0])}</div>
                <div><h5>${esc(chr.name)} <span class="c-role">${esc(c.role)}</span></h5>
                <div class="c-view">${c.view}</div>
                <div class="c-view dim">偏好：${esc(c.bias)}${c.disputed ? ' · 情报需交叉核实' : ''}</div></div></div>`;
            }).join('')}
            <div class="councilor dead"><div class="c-ava">王</div><div><h5>王猛 · 丞相（卒于375年）</h5>
              <div class="c-view">卒于375年，383年军议不设此席 —— 人物在世区间受剧本约束。</div></div></div>
            <div class="intel-note">胜率与损耗区间只使用经测试的战斗模拟结果，并标注假设与信息不足；无可靠模型时显示定性风险。</div>
          </div>
          <div class="council-right">
            <h3>行动方案 —— 三案并排比较</h3>
            <div class="cr-sub">点击方案仅绘制预览箭头；确认后才转为军令草案。</div>
            <div class="proposal-grid">
              ${ch.proposals.map(p => `
                <div class="proposal ${councilProposal === p.id ? 'selected' : ''}" data-pid="${p.id}">
                  <h4>方案${esc(p.id)} ${esc(p.name)}<span class="p-kind">${esc(p.kind)}</span></h4>
                  <div class="p-row"><b>依赖</b>${esc(p.relies)}</div>
                  <div class="p-row"><b>成本</b>${esc(p.cost)}</div>
                  <div class="p-row"><b>风险</b>${esc(p.risk)}</div>
                  <div class="p-row"><b>退路</b>${esc(p.fallback)}</div>
                  <div class="p-row"><b>放弃</b>${esc(p.givesUp)}</div>
                  <div class="p-preview">${esc(p.preview)}</div>
                </div>`).join('')}
            </div>
            <div class="council-actions">
              <button class="btn primary" id="cv-confirm" ${councilProposal ? '' : 'disabled'}>拟为军令草案</button>
              <button class="btn" id="cv-cancel-p" ${councilProposal ? '' : 'disabled'}>撤销预览</button>
              <span class="dim">方案预览只画箭头，不改动任何状态。</span>
            </div>
            <div id="cv-draft"></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(mask);
    mask.querySelector('.ov-close').addEventListener('click', () => mask.remove());
    mask.addEventListener('click', (e) => { if (e.target === mask) mask.remove(); });

    mask.querySelectorAll('.proposal').forEach(el => el.addEventListener('click', () => {
      councilProposal = el.dataset.pid;
      mask.querySelectorAll('.proposal').forEach(x => x.classList.toggle('selected', x === el));
      $('#cv-confirm').disabled = false;
      $('#cv-cancel-p').disabled = false;
      // 只绘制预览箭头
      const S2 = State.current();
      const p = ch.proposals.find(x => x.id === councilProposal);
      if (p.id === 'A') SHL.Map3D.drawMarchArrow('scouts', bfsPath('dukou', 'dukou').length > 1 ? bfsPath('dukou', 'dukou') : ['camp', 'dukou', 'bagong'], 0x657C82);
      if (p.id === 'B') SHL.Map3D.drawMarchArrow('transport', ['liangdao', 'reed', 'dukou'], 0x9C8665);
      if (p.id === 'C') { SHL.Map3D.drawMarchArrow('transport', ['liangdao', 'reed', 'dukou'], 0x9C8665); SHL.Map3D.drawMarchArrow('beifu', ['camp', 'bagong', 'dukou'], 0x984C3F); }
      SHL.Audio.tick();
    }));
    $('#cv-cancel-p').addEventListener('click', () => {
      councilProposal = null;
      mask.querySelectorAll('.proposal').forEach(x => x.classList.remove('selected'));
      $('#cv-confirm').disabled = true;
      SHL.Map3D.clearMarchArrows();
    });
    $('#cv-locate').addEventListener('click', () => { mask.remove(); pickNode('dukou'); });
    $('#cv-track').addEventListener('click', () => toast('来源追踪：船家所言与斥候同源，不作独立证据。', 'info'));

    $('#cv-confirm').addEventListener('click', () => {
      if (!councilProposal) return;
      const S2 = State.current();
      const p = ch.proposals.find(x => x.id === councilProposal);
      S2.councilChosen = councilProposal;
      let draft = '';
      if (p.id === 'A') {
        State.addOrder({ kind: 'scout', legionId: 'scouts', label: '斥候乙队', grain: 20, turns: 1, from: 'dukou', to: 'dukou', fromName: '渡口', toName: '渡口', path: ['camp', 'dukou'], desc: '增派侦察，核实后再动' });
        draft = `执行单位：斥候乙队<br>路线：东岸大营 → 渡口（往返）<br>时限：1回合<br>终止条件：回报核实或失联；失联则按过时情报处理`;
      } else if (p.id === 'B') {
        State.addOrder({ kind: 'march', legionId: 'transport', label: '石仓运输队', grain: 240, turns: 2, from: 'liangdao', to: 'dukou', fromName: '粮道·三汊河', toName: '渡口', path: ['liangdao', 'reed', 'dukou'], desc: '改道经苇泽，承担额外粮耗' });
        draft = `执行单位：石仓运输队<br>路线：三汊河 → 苇泽北缘 → 渡口<br>时限：2回合（多耗3日粮）<br>终止条件：辎重受袭即折回官道`;
      } else {
        State.addOrder({ kind: 'escort', legionId: 'beifu', label: '北府先锋营', grain: 320, turns: 1, from: 'camp', to: 'dukou', fromName: '东岸大营', toName: '渡口', path: ['camp', 'bagong', 'dukou'], desc: '以一部掩护运输强渡' });
        State.addOrder({ kind: 'escort', legionId: 'transport', label: '石仓运输队', grain: 0, turns: 1, from: 'liangdao', to: 'dukou', fromName: '粮道·三汊河', toName: '渡口', path: ['liangdao', 'reed', 'dukou'], desc: '随先锋营渡河' });
        draft = `执行单位：北府先锋营（掩护）＋ 石仓运输队<br>路线：大营 → 八公山 → 渡口 强渡<br>时限：1回合 · 渡口将触发关键交锋<br>终止条件：粮车过河，或伤亡三成即退回东岸`;
      }
      $('#cv-draft').innerHTML = `
        <div class="junling-draft">
          <h4>军令草案 <span class="ai-mark">地图预演已绘</span></h4>
          ${draft}
          <div style="display:flex;gap:10px;margin-top:10px">
            <button class="btn primary" id="jl-issue">明确下令</button>
            <span class="dim">规则层验证后由你确认执行；推进回合前可撤销。</span>
          </div>
        </div>`;
      $('#jl-issue').addEventListener('click', () => {
        SHL.Audio.confirm();
        mask.remove();
        renderRightPanel(); updateEndTurn();
        toast('军令已入队 —— 推进回合后生效', 'good');
      });
    });
  }

  /* ═══════════════ 战报与史鉴 ═══════════════ */
  function openReport(result) {
    const S = State.current();
    State.resolveTodo('渡口战报待阅');
    const mask = document.createElement('div');
    mask.className = 'ov-mask'; mask.id = 'ov-report';
    mask.innerHTML = `
      <div class="ov-card">
        <div class="ov-backnote">关闭回待办列表</div>
        <button class="ov-close">✕</button>
        <div class="report-layout">
          <div class="report-main">
            <h3>渡口护粮 · 战报</h3>
            <div class="r-sub">${esc(result.delegated ? '委任结算' : '亲自指挥结算')} · 只回写一次 · 第${S.turn}回合</div>
            <div class="rep-sec">
              <h4>结果</h4>
              <p style="font-size:15px;line-height:2">${result.win ? '<b style="color:var(--caomu)">任务达成</b>' : '<b style="color:var(--zhusha)">任务未达</b>'} —— ${esc(result.text)}</p>
            </div>
            <div class="rep-sec">
              <h4>代价</h4>
              <table class="rep-table">
                <tr><th>项目</th><th>数值</th><th>说明</th></tr>
                <tr><td>我方伤亡</td><td><b class="num-neg">${result.losses.player}</b> 人</td><td>阵亡与重伤分列，伤员${result.wounded || 0}人需后送</td></tr>
                <tr><td>敌方伤亡</td><td><b class="num-pos">${result.losses.enemy}</b> 人</td><td>含溃散，为估计值</td></tr>
                <tr><td>辎重保存</td><td><b>${Math.round((result.convoyHp || 0) * 100)}%</b></td><td>粮车与随行军资</td></tr>
                <tr><td>粮秣</td><td>已扣本回合消耗</td><td>资源账目由规则产生</td></tr>
              </table>
            </div>
            <div class="rep-sec">
              <h4>原方案假设 · 事后对照</h4>
              <div class="assump">
                ${(result.assumptions || []).map(a => `<div class="${a.ok ? 'ok' : 'bad'}">${a.ok ? '✓' : '✗'} ${esc(a.k)} —— ${esc(a.note)}</div>`).join('')}
              </div>
              <p class="dim" style="font-size:12.5px;margin-top:6px">战后复盘：AI 解释原判断哪些成立、哪些失效；失误可定位并更新情报档案。</p>
            </div>
            <div class="rep-sec">
              <h4>事件回放</h4>
              <div style="font-size:13.5px;line-height:2">
                ${result.delegated ? '委任结算不展开逐帧回放；核心信息如上。' : `交锋用时 ${Math.floor((result.time || 0) / 60)}分${(result.time || 0) % 60}秒。`}
                ${result.win ? '运输队自粮道经渡口西去；' : '残部自苇泽方向退回东岸；'}战损已写入世界状态。
              </div>
            </div>
          </div>
          <div class="report-side">
            <h4 style="font-family:var(--f-title);font-size:18px;letter-spacing:3px;margin-bottom:10px">史鉴</h4>
            ${State.history.map(h => `
              <div class="shibook">
                <h5><span class="tag ${h.tag}">${{ hist: '史载', disp: '争议', sim: '本局推演' }[h.tag]}</span>${esc(h.title)}</h5>
                ${esc(h.text)}
                <div class="src">${esc(h.src)}</div>
              </div>`).join('')}
            ${S.epic.length ? `<div class="epic-note"><b>人物史诗 · 刘牢之</b><br>${esc(S.epic[S.epic.length - 1].text)}</div>` : ''}
          </div>
        </div>
      </div>`;
    document.body.appendChild(mask);
    mask.querySelector('.ov-close').addEventListener('click', () => { mask.remove(); afterReport(); });
    mask.addEventListener('click', (e) => { if (e.target === mask) { mask.remove(); afterReport(); } });
  }
  function afterReport() {
    updateTopbar(); renderLeftPanel(); renderRightPanel(); renderCommandBar(); updateEndTurn();
    SHL.Map3D.refreshLegions();
  }

  /* ═══════════════ HUD 图层 ═══════════════ */
  const LEGENDS = {
    terrain: '地形注记 —— 墨色：山脊高地 · 青：河渡 · 赭：农田 · 灰白纸雾：未侦察区。<br>放大后显示坡度与通行属性。',
    supply: '粮道层 —— 石仓粮囤 → 三汊河 → 东岸大营 → 渡口。运输队位置与截断风险高亮。<br>此坡不能形成骑兵冲锋距离等代价将随路径预览显示。',
    intel: '侦报层 —— <span style="color:var(--shiqing)">青框已核实</span> · <span style="color:var(--tu)">土色过时</span> · <span style="color:var(--ink-3)">灰白未侦察</span>。<br>情报过时显示记录日期，矛盾情报并排呈现。',
    weather: `天气层 —— ${SHL.State.current() ? SHL.State.current().weather : ''}<br>影响：视距、通行与转运容量；逐步变化，有预报与观察。`,
  };
  function bindHud() {
    $$('.hud-btn').forEach(b => b.addEventListener('click', () => {
      $$('.hud-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      const map = { 'hud-terrain': 'terrain', 'hud-supply': 'supply', 'hud-intel': 'intel', 'hud-weather': 'weather' };
      SHL.Map3D.setLayer(map[b.id]);
      $('#hud-legend').innerHTML = LEGENDS[map[b.id]];
      SHL.Audio.tick();
    }));
    $('#hud-legend').innerHTML = LEGENDS.terrain;
  }

  /* ═══════════════ 面包屑 / 面板折叠 ═══════════════ */
  function bindChrome() {
    $$('.crumb').forEach(c => c.addEventListener('click', () => {
      const lv = c.dataset.level;
      if (lv === 'world') { SHL.Map3D.switchLevel('world'); setBreadcrumb('world'); setSiteBreadcrumb(null); }
      else { SHL.Map3D.switchLevel('theater'); setBreadcrumb('theater'); }
      SHL.Audio.tick();
    }));
    $('.crumb[data-level="site"]').textContent = '寿阳';

    $('#lp-fold').addEventListener('click', () => {
      $('#left-panel').classList.add('folded');
      $('#lp-unfold').classList.remove('hidden');
    });
    $('#lp-unfold').addEventListener('click', () => {
      $('#left-panel').classList.remove('folded');
      $('#lp-unfold').classList.add('hidden');
    });
    $$('.lp-tab').forEach(t => t.addEventListener('click', () => { ui.lpTab = t.dataset.tab; renderLeftPanel(); SHL.Audio.tick(); }));
    $$('.rp-tab').forEach(t => t.addEventListener('click', () => { ui.rpTab = t.dataset.tab; renderRightPanel(); SHL.Audio.tick(); }));

    // 小地图点击跳转
    $('#mm-canvas').addEventListener('click', (e) => {
      // 原型：点击小地图切到天下
      SHL.Map3D.switchLevel('world');
      setBreadcrumb('world');
    });

    // 顶栏按钮
    $('#btn-save').addEventListener('click', () => { State.save(); toast('已存档（含未完成指令与已解决交锋节点）', 'good'); });
    $('#btn-settings2').addEventListener('click', () => $('#modal-settings').classList.remove('hidden'));
    $('#btn-settings').addEventListener('click', () => $('#modal-settings').classList.remove('hidden'));
    $('#set-close').addEventListener('click', () => $('#modal-settings').classList.add('hidden'));
    $('#btn-tochapter').addEventListener('click', () => {
      State.save();
      showScreen('chapter');
    });
  }

  /* ═══════════════ 设置 ═══════════════ */
  function bindSettings() {
    $$('#seg-uiscale button').forEach(b => b.addEventListener('click', () => {
      $$('#seg-uiscale button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      document.body.dataset.uiscale = b.dataset.v;
    }));
    $$('#seg-cam button').forEach(b => b.addEventListener('click', () => {
      $$('#seg-cam button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      SHL.Map3D.applySettings({ camFast: b.dataset.v === 'fast' });
    }));
    $('#set-reduce').addEventListener('change', (e) => {
      document.body.classList.toggle('reduce-motion', e.target.checked);
      SHL.Map3D.applySettings({ reduceMotion: e.target.checked });
    });
    $('#set-hicon').addEventListener('change', (e) => {
      document.body.classList.toggle('hi-contrast', e.target.checked);
    });
    $('#set-sound').addEventListener('change', (e) => SHL.Audio.setEnabled(e.target.checked));
  }

    /* ═══════════════ Esc 层级返回 ═══════════════ */
  function bindEsc() {
    // map3d onLevel('esc') 回调在 main.js 注入，此处仅保留挂载点
  }

  return {
    init,
    showScreen, toast,
    buildChapterSelect, enterStrategy,
    updateTopbar, renderLeftPanel, renderRightPanel, renderCommandBar, updateEndTurn,
    pickNode, setBreadcrumb, setSiteBreadcrumb, showMarchPreview, cancelMarchPending,
    openCity, openLegion, openCouncil, openReport,
    promptBattle, startBattle,
    showSettle,
    ui,
  };

  function init() {
    buildChapterSelect();
    bindEndTurn();
    bindHud();
    bindChrome();
    bindSettings();
    bindEsc();
  }
})();
