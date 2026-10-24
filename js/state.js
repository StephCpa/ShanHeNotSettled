/* ═════════════════════════════════════════════════
   十六国 · 山河未定 — 回合引擎与指令队列
   命令先进队列，可编辑；推进回合前只汇总真正阻塞的问题；
   结算不因折叠暂停；自动存档包含未完成指令与已解决交锋节点。
   ═════════════════════════════════════════════════ */
window.SHL = window.SHL || {};

SHL.State = (function () {
  'use strict';
  const D = SHL.DATA;

  const SEASONS = ['春','夏','秋','冬'];

  let S = null;          // 当前局面
  const listeners = {};  // 简单事件

  function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
  function emit(ev, arg) { (listeners[ev] || []).forEach(f => f(arg)); }

  /* ───────── 初始化 ───────── */
  function newGame(perspective) {
    S = {
      version: 'proto-1.0', rules: 'rules-1.0',
      chapter: 'qin-tong', scenario: 'feishui',
      perspective: perspective || 'jin',   // 东晋 / 前秦
      mode: 'history',
      turn: 1, year: 383, seasonIdx: 2,    // 383年 秋
      phase: '筹划',
      weather: '晴，淮上有薄雾',
      res: { grain: 12400, gold: 3800, troops: 9500 },
      resDetail: { grainIn: 260, grainOut: 340, goldIn: 120, note: '江南漕运秋赋将至' },
      legions: deepCopy(D.legions),
      intel: {
        dukou: { state: 'unverified', title: '渡口敌情待核', text: '西岸见炊烟数十处，兵力未辨', day: '一日前' },
      },
      queue: [],          // 待执行军令
      proposals: {},      // 军议选择记录
      councilChosen: null,
      todos: [],
      log: [],
      battleDukouDone: null,   // 交锋结果回写标记，避免重复结算
      epic: [],           // 人物史诗记录
      flags: { scoutedDukou: false, routeChanged: false, escortStarted: false },
    };
    addTodo('intel', '渡口敌情待核', '侦报尚未交叉验证 —— 到军议中处置', 'dukou');
    addTodo('transport', '秋赋护送待定', '石仓运输队等候行止（粮道·三汊河）', 'liangdao');
    addTodo('event', '洛涧捷报待分发', '前军已破洛涧，士心思战', 'qianxian');
    pushLog('回合1 · 开局', '洛涧已破，秦军沿淝水西岸列阵。东岸筹谋，正待将令。');
    save();
  }

  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

  /* ───────── 待办 ───────── */
  function addTodo(kind, title, desc, anchor) {
    if (S.todos.find(t => t.title === title)) return;
    S.todos.push({ id: 'todo' + Date.now() + Math.random().toString(36).slice(2, 6), kind, title, desc, anchor });
    emit('todos');
  }
  function resolveTodo(title) {
    S.todos = S.todos.filter(t => t.title !== title);
    emit('todos');
  }

  /* ───────── 军令队列 ───────── */
  // order: {id, kind:'march'|'escort'|'scout'|'stance'|'other', legionId, from, to, label, turns, grain, desc, conflict}
  function addOrder(o) {
    o.id = 'ord' + Date.now() + Math.random().toString(36).slice(2, 5);
    S.queue.push(o);
    emit('queue');
    return o;
  }
  function removeOrder(id) { S.queue = S.queue.filter(q => q.id !== id); emit('queue'); }
  function ordersOfLegion(lid) { return S.queue.filter(q => q.legionId === lid); }

  /* 阻塞性冲突检查：推进回合前只汇总真正阻塞的问题 */
  function blockingIssues() {
    const issues = [];
    // 同一军团两条互斥行军令
    const byLegion = {};
    S.queue.forEach(q => {
      if (q.kind === 'march' || q.kind === 'escort') {
        byLegion[q.legionId] = byLegion[q.legionId] || [];
        byLegion[q.legionId].push(q);
      }
    });
    Object.keys(byLegion).forEach(lid => {
      if (byLegion[lid].length > 1) {
        const L = S.legions[lid];
        issues.push(`${L ? L.name : lid} 同时有多条移动军令，须先取舍。`);
      }
    });
    // 粮秣不足
    const needGrain = S.queue.reduce((s, q) => s + (q.grain || 0), 0);
    if (needGrain > S.res.grain) issues.push(`军令合计需粮 ${needGrain} 石，超过库存 ${S.res.grain} 石。`);
    // 渡口情报未处理就推进（提示性，不阻塞）
    return issues;
  }

  function softWarnings() {
    const w = [];
    if (S.intel.dukou && S.intel.dukou.state === 'unverified' && !S.flags.scoutedDukou)
      w.push('渡口情报尚未核实，相关军令存在未知路段风险。');
    const beifu = S.legions.beifu;
    if (beifu && beifu.fatigue > 50) w.push('北府先锋营疲劳过高，行军损耗将上升。');
    return w;
  }

  /* ───────── 推进回合 ───────── */
  let settleRunner = null;
  function endTurn() {
    if (settleRunner) return { ok: false, reason: '结算进行中' };
    const issues = blockingIssues();
    if (issues.length) return { ok: false, issues };

    const lines = [];
    S.phase = '结算';

    // 1. 侦察类军令先行
    S.queue.forEach(q => {
      if (q.kind === 'scout') {
        S.flags.scoutedDukou = true;
        lines.push({ t: '侦', text: `${q.label || '斥候乙队'} 亥时抵渡口西岸，核实完毕。`, cls: 'ev' });
      }
    });

    // 2. 渡口情报更新（依据军议选择）
    if (S.flags.scoutedDukou) {
      S.intel.dukou = { state: 'confirmed', title: '渡口敌情已核实', text: '西岸为秦军前锋营，约三千骑步，无浮桥，正伐木为筏', day: '本回合核实' };
      lines.push({ t: '报', text: '渡口核实：秦军前锋约三千，无浮桥，正伐木为筏。', cls: 'ev' });
      resolveTodo('渡口敌情待核');
    } else if (S.intel.dukou.state === 'unverified') {
      S.intel.dukou.day = '二日前（情报过时）';
      S.intel.dukou.state = 'stale';
      lines.push({ t: '报', text: '渡口情报过时，仍未核实。西岸炊烟较昨更密。', cls: '' });
    }

    // 3. 行军结算
    S.queue.forEach(q => {
      if (q.kind === 'march' || q.kind === 'escort') {
        const L = S.legions[q.legionId];
        if (!L) return;
        const step = L.stance === 'fast' ? 2 : 1;
        L.march = { path: q.path || [q.from, q.to], progress: 0, step, orderId: q.id, label: q.label };
        L.supplyDays -= (q.turns || 1) * 2;
        L.fatigue = Math.min(100, L.fatigue + (L.stance === 'fast' ? 18 : 8));
        lines.push({ t: '行', text: `${L.name} 自 ${q.fromName || '现地'} 出发（${stanceName(L.stance)}），预计 ${q.turns} 回合抵 ${q.toName || q.to}。`, cls: 'good' });
        if (q.kind === 'escort' && !S.flags.escortStarted) {
          S.flags.escortStarted = true;
          lines.push({ t: '护', text: '运输队随行，粮车两百乘出三汊河。', cls: '' });
        }
      }
      if (q.kind === 'stance') {
        const L = S.legions[q.legionId];
        if (L) { L.stance = q.stance; lines.push({ t: '令', text: `${L.name} 行军态势改为「${stanceName(q.stance)}」。`, cls: '' }); }
      }
    });

    // 4. 触发渡口交锋（护送抵达渡口且未结算过）
    let battleTrigger = false;
    if (S.flags.escortStarted && !S.battleDukouDone) {
      const T = S.legions.transport, B = S.legions.beifu;
      if (T && (T.node === 'dukou' || (T.march && T.march.path.includes('dukou')) || true)) {
        battleTrigger = true;
        lines.push({ t: '战', text: '秦军前锋扑向渡口粮道 —— 关键交锋节点，需决定是否亲自指挥。', cls: 'ev' });
      }
    }

    // 5. 资源与时间
    const grainBurn = 620 + S.queue.reduce((s, q) => s + (q.grain || 0), 0);
    S.res.grain -= grainBurn;
    S.res.gold += S.resDetail.goldIn;
    S.turn += 1;
    S.seasonIdx = (S.seasonIdx + 1) % 4;
    if (S.seasonIdx === 0) S.year += 1;
    S.weather = pickWeather(S.seasonIdx);
    lines.push({ t: '计', text: `大军消耗粮秣 ${grainBurn} 石，存 ${S.res.grain} 石。时入${SEASONS[S.seasonIdx]}，${S.weather}。`, cls: '' });
    if (S.res.grain < 3000) lines.push({ t: '警', text: '粮秣告急！江南漕运未至，须速定护粮之策。', cls: 'ev' });

    // 6. 清队列
    S.queue = [];
    S.phase = '筹划';

    // 7. 新待办
    if (S.intel.dukou.state !== 'confirmed' && !S.flags.scoutedDukou)
      addTodo('intel', '渡口敌情仍待核', '侦报已过时 —— 军议需重定方案', 'dukou');
    if (S.res.grain < 5000) addTodo('log', '粮秣告急', '存粮不足五千石，查看军需账目', 'granary');

    pushLog(`回合${S.turn}`, lines.map(l => l.text).join(' '));
    settleRunner = { lines, battleTrigger };
    save();
    return { ok: true, lines, battleTrigger };
  }

  function pickWeather(season) {
    const w = [
      ['晴，江淮回暖', '细雨，道路泥泞', '晴，风自东南'],
      ['暑热，淮水浅', '雷雨，苇泽水涨', '晴，蝉鸣不歇'],
      ['晴，淮上有薄雾', '秋雨连绵，辎重行迟', '晴，霜降'],
      ['北风起，初雪', '晴，河冰未合', '大雪封苇泽'],
    ];
    const arr = w[season];
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function takeSettle() { const r = settleRunner; settleRunner = null; return r; }
  function settlePending() { return !!settleRunner; }

  function stanceName(s) { return s === 'fast' ? '急行' : s === 'avoid' ? '避敌' : '稳行'; }

  /* ───────── 交锋回写（只回写一次） ───────── */
  function writeBattleResult(result) {
    if (S.battleDukouDone) return false;
    S.battleDukouDone = result;
    const beifu = S.legions.beifu;
    if (beifu) {
      beifu.fatigue = Math.min(100, beifu.fatigue + 25);
      beifu.morale = Math.max(20, Math.min(100, beifu.morale + (result.win ? 6 : -10)));
      beifu.infantry -= (result.losses.player || 0);
      if (beifu.infantry < 0) beifu.infantry = 0;
      beifu.node = 'dukou';
    }
    if (S.legions.transport) S.legions.transport.node = result.win ? 'dukou' : 'liangdao';
    if (result.grainSaved != null) {
      S.res.grain += 0; // 粮车回写已在 battle 内计算
    }
    S.epic.push({
      char: 'liulaozhi', node: '渡口护粮', year: S.year,
      text: `${result.win ? '督粮车渡淝水，挫秦军前锋。' : '粮道受阻，敛兵退还东岸。'}（本局推演）`,
    });
    resolveTodo('秋赋护送待定');
    addTodo('report', '渡口战报待阅', '交锋已结算 —— 查看战报与史鉴', 'dukou');
    pushLog(`回合${S.turn} · 交锋`, `渡口护粮之战：我军伤亡${result.losses.player || 0}，敌军伤亡${result.losses.enemy || 0}，辎重保存${Math.round((result.convoyHp || 0) * 100)}%。`);
    save();
    return true;
  }

  /* ───────── 史料页数据（史载 / 争议 / 推演 三分） ── */
  const history = [
    { tag: 'hist', title: '太元八年 · 秦兵略淮南', src: '《晋书》《资治通鉴》纪年线索',
      text: '383年，苻坚遣苻融率前锋二十五万（史称）渡淮，攻寿阳。晋以谢石为大都督、谢玄为前锋都督，率北府兵八万拒之。' },
    { tag: 'disp', title: '兵力记载存争议', src: '史载口径不一',
      text: '秦军号称百万，史册所记实数差异甚大。本作不伪造精确数字，军团规模以「本部可见/估计」区分呈现。' },
    { tag: 'hist', title: '王猛卒于375年', src: '《晋书·王猛传》',
      text: '故383年的军议中，王猛不作为在场谋士发言。人物在世区间受剧本约束。' },
    { tag: 'sim', title: '本局推演记录', src: '随战局生成',
      text: '此处逐回合记录你的推演：指令、交锋与后果，与史载分列，不相互冒充。' },
  ];

  /* ───────── 存档 ───────── */
  const KEY = 'shl-save-v1';
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return false;
      const o = JSON.parse(raw);
      if (!o || o.version !== 'proto-1.0') return false;
      S = o; return true;
    } catch (e) { return false; }
  }
  function hasSave() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } }
  function clearSave() { try { localStorage.removeItem(KEY); } catch (e) {} }
  function current() { return S; }

  pushLog = function (turn, text) {
    S.log.unshift({ turn, text, time: Date.now() });
    if (S.log.length > 60) S.log.pop();
    emit('log');
  };
  var pushLog; // hoisted usage

  return {
    newGame, current, save, load, hasSave, clearSave,
    addOrder, removeOrder, ordersOfLegion, blockingIssues, softWarnings,
    endTurn, takeSettle, settlePending, stanceName,
    writeBattleResult, addTodo, resolveTodo,
    history, SEASONS, on, emit,
  };
})();
