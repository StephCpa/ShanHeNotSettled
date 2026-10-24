/* ═════════════════════════════════════════════════
   十六国 · 山河未定 — 回合引擎与指令队列
   阶段机：筹划 → 结算（瞬态） → 筹划 / 待交锋 → 待阅战报 → 筹划
   - 命令先进队列，可编辑；推进前只汇总真正阻塞的问题
   - 行军逐回合推进，抵达/接敌事件触发交锋
   - 交锋结果一次性回写（兵力按类型、辎重按载量）
   - 阶段与待处理事件随存档持久化
   ═════════════════════════════════════════════════ */
window.SHL = window.SHL || {};

SHL.State = (function () {
  'use strict';
  const D = SHL.DATA;

  const SEASONS = ['春', '夏', '秋', '冬'];
  const BASE_UPKEEP = 620;   // 驻军口粮与马匹耗用/回合（与界面预览一致）

  let S = null;              // 当前局面（可持久化部分）
  let settleRunner = null;   // 结算演出（瞬态，不进存档）
  const listeners = {};

  function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
  function emit(ev, arg) { (listeners[ev] || []).forEach(f => f(arg)); }
  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ───────── 初始化 ───────── */
  function newGame(perspective) {
    settleRunner = null;
    S = {
      version: 'proto-1.1', rules: 'rules-1.1',
      chapter: 'qin-tong', scenario: 'feishui',
      perspective: perspective || 'jin',
      mode: 'history',
      turn: 1, year: 383, seasonIdx: 2,
      phase: '筹划',                 // 筹划 | 结算 | 待交锋 | 待阅战报
      weather: '晴，淮上有薄雾',
      res: { grain: 12400, gold: 3800, troops: 9500 },
      resDetail: { grainIn: 260, grainOut: BASE_UPKEEP, goldIn: 120, note: '江南漕运秋赋将至' },
      legions: deepCopy(D.legions),
      intel: {
        dukou: { state: 'unverified', title: '渡口敌情待核', text: '西岸见炊烟数十处，兵力未辨', day: '一日前' },
        verifiedTurn: 0,
      },
      queue: [],
      councilChosen: null,
      todos: [],
      log: [],
      battleDukouDone: null,
      lastBattleResult: null,        // 待阅战报使用
      epic: [],
      flags: { scoutedDukou: false, routeChanged: false, escortStarted: false },
    };
    addTodo('intel', '渡口敌情待核', '侦报尚未交叉验证 —— 到军议中处置', 'dukou');
    addTodo('transport', '秋赋护送待定', '石仓运输队等候行止（粮道·三汊河）', 'liangdao');
    addTodo('event', '洛涧捷报待分发', '前军已破洛涧，士心思战', 'qianxian');
    pushLog('回合1 · 开局', '洛涧已破，秦军沿淝水西岸列阵。东岸筹谋，正待将令。');
    save();
  }

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
  function addOrder(o) {
    o.id = 'ord' + Date.now() + Math.random().toString(36).slice(2, 5);
    S.queue.push(o);
    emit('queue');
    return o;
  }
  function removeOrder(id) { S.queue = S.queue.filter(q => q.id !== id); emit('queue'); }
  function ordersOfLegion(lid) { return S.queue.filter(q => q.legionId === lid); }

  function blockingIssues() {
    const issues = [];
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
    const needGrain = S.queue.reduce((s, q) => s + (q.grain || 0), 0) + S.resDetail.grainOut;
    if (needGrain > S.res.grain) issues.push(`本回合军需合计需粮 ${needGrain} 石，超过库存 ${S.res.grain} 石。`);
    return issues;
  }

  function softWarnings() {
    const w = [];
    if (S.intel.dukou.state !== 'confirmed' && !S.flags.scoutedDukou)
      w.push('渡口情报尚未核实，相关军令存在未知路段风险。');
    const beifu = S.legions.beifu;
    if (beifu && beifu.fatigue > 50) w.push('北府先锋营疲劳过高，行军损耗将上升。');
    return w;
  }

  /* ───────── 推进回合 ───────── */
  function endTurn() {
    if (settleRunner) return { ok: false, reason: '结算进行中' };
    const issues = blockingIssues();
    if (issues.length) return { ok: false, issues };

    const lines = [];
    S.phase = '结算';

    /* 1. 侦察类军令 → 情报核实 */
    S.queue.forEach(q => {
      if (q.kind === 'scout') {
        S.flags.scoutedDukou = true;
        S.intel.verifiedTurn = S.turn;
        S.intel.dukou = {
          state: 'confirmed', title: '渡口敌情已核实',
          text: '西岸为秦军前锋营，约三千骑步，无浮桥，正伐木为筏',
          day: '本回合核实',
        };
        lines.push({ t: '侦', text: `${q.label || '斥候乙队'} 亥时抵渡口西岸，核实完毕。`, cls: 'ev' });
      }
    });

    /* 2. 情报老化（核实一回合后转过时） */
    const I = S.intel.dukou;
    if (I.state === 'confirmed' && S.turn - (S.intel.verifiedTurn || 0) >= 1) {
      I.state = 'stale';
      I.day = (S.turn - S.intel.verifiedTurn) + '回合前（情报过时）';
      lines.push({ t: '报', text: '渡口情报已过时，西岸动向未知。', cls: '' });
    } else if (I.state === 'unverified') {
      I.state = 'stale';
      I.day = (S.turn) + '回合仍无回报（情报过时）';
      lines.push({ t: '报', text: '渡口情报过时，仍未核实。西岸炊烟较昨更密。', cls: '' });
    }

    /* 3. 消耗新军令 → 转为行军状态 */
    let orderGrain = 0;
    S.queue.forEach(q => {
      if (q.kind === 'march' || q.kind === 'escort') {
        const L = S.legions[q.legionId];
        if (!L) return;
        const step = L.stance === 'fast' ? 2 : 1;
        L.march = { path: q.path || [q.from, q.to], progress: 0, step, kind: q.kind };
        L.supplyDays = Math.max(0, L.supplyDays - (q.turns || 1) * 2);
        orderGrain += (q.grain || 0);
        lines.push({ t: '行', text: `${L.name} 自 ${q.fromName || '现地'} 出发（${stanceName(L.stance)}），预计 ${q.turns} 回合抵 ${q.toName || q.to}。`, cls: 'good' });
        if (q.kind === 'escort' && !S.flags.escortStarted) {
          S.flags.escortStarted = true;
          lines.push({ t: '护', text: '运输队随行，粮车两百乘出三汊河。', cls: '' });
        }
      } else if (q.kind === 'stance') {
        const L = S.legions[q.legionId];
        if (L) { L.stance = q.stance; lines.push({ t: '令', text: `${L.name} 行军态势改为「${stanceName(q.stance)}」。`, cls: '' }); }
      }
    });
    S.queue = [];

    /* 4. 逐回合推进在途行军；抵达触发事件 */
    let battleTrigger = false;
    Object.values(S.legions).forEach(L => {
      if (!L.march) return;
      const M = L.march;
      M.progress = Math.min(M.path.length - 1, M.progress + M.step);
      L.node = M.path[M.progress];
      L.fatigue = clamp(L.fatigue + (M.step > 1 ? 14 : 7), 0, 100);
      const remain = (M.path.length - 1) - M.progress;
      if (M.progress >= M.path.length - 1) {
        lines.push({ t: '行', text: `${L.name} 抵达${nodeName(L.node)}。`, cls: 'good' });
        L.march = null;
        if (L.id === 'transport' && L.node === 'dukou' && !S.battleDukouDone) {
          battleTrigger = true;
          lines.push({ t: '战', text: '运输队行至渡口，与秦军前锋接敌 —— 关键交锋节点，需决定是否亲自指挥。', cls: 'ev' });
        } else if (L.node === 'dukou' && L.id !== 'transport' && !S.battleDukouDone) {
          lines.push({ t: '报', text: `${L.name} 于渡口西望，见秦军前锋营垒，暂未接战。`, cls: '' });
        }
      } else {
        lines.push({ t: '行', text: `${L.name} 行至${nodeName(L.node)}（余 ${remain} 回合）。`, cls: '' });
      }
    });

    /* 5. 资源与时间（预览与结算同一口径） */
    const income = S.resDetail.grainIn, upkeep = S.resDetail.grainOut;
    S.res.grain += income - (upkeep + orderGrain);
    S.res.gold += S.resDetail.goldIn;
    S.res.troops = countTroops();
    S.turn += 1;
    S.seasonIdx = (S.seasonIdx + 1) % 4;
    if (S.seasonIdx === 0) S.year += 1;
    S.weather = pickWeather(S.seasonIdx);
    const net = income - upkeep - orderGrain;
    lines.push({ t: '计', text: `粮秣 ${net >= 0 ? '+' : ''}${net} 石（入${income}·耗${upkeep + orderGrain}），存 ${S.res.grain} 石。时入${SEASONS[S.seasonIdx]}，${S.weather}。`, cls: net < 0 ? '' : 'good' });
    if (S.res.grain < 3000) lines.push({ t: '警', text: '粮秣告急！江南漕运未至，须速定护粮之策。', cls: 'ev' });

    /* 6. 阶段与待办 */
    S.phase = battleTrigger ? '待交锋' : '筹划';
    if (I.state !== 'confirmed' && !S.flags.scoutedDukou && S.turn > 2)
      addTodo('intel', '渡口敌情仍待核', '侦报已过时 —— 军议需重定方案', 'dukou');
    if (S.res.grain < 5000) addTodo('log', '粮秣告急', '存粮不足五千石，查看军需账目', 'granary');

    pushLog(`回合${S.turn - 1}`, lines.map(l => l.text).join(' '));
    settleRunner = { lines, battleTrigger };
    save();
    return { ok: true, lines, battleTrigger };
  }

  function countTroops() {
    return Object.values(S.legions)
      .filter(L => !L.intel)
      .reduce((s, L) => s + (L.infantry + L.cavalry + L.archer), 0);
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
  function nodeName(id) { const n = D.theaterHuainan.nodes[id]; return n ? n.name : id; }

  /* ───────── 交锋回写（一次性，按类型扣减） ───────── */
  function writeBattleResult(result) {
    if (S.battleDukouDone) return false;
    S.battleDukouDone = {
      win: result.win, text: result.text, time: result.time,
      losses: result.losses, convoyHp: result.convoyHp,
    };
    const ld = result.lossDetail || { player: {}, enemy: {} };
    const beifu = S.legions.beifu;
    const transport = S.legions.transport;
    if (beifu) {
      beifu.infantry = Math.max(0, beifu.infantry - (ld.player.infantry || 0));
      beifu.cavalry = Math.max(0, beifu.cavalry - (ld.player.cavalry || 0));
      beifu.archer = Math.max(0, beifu.archer - (ld.player.archer || 0));
      beifu.morale = clamp(beifu.morale + (result.win ? 6 : -10), 20, 100);
      beifu.fatigue = clamp(beifu.fatigue + 22, 0, 100);
      beifu.node = 'dukou';
      beifu.march = null;
    }
    if (transport) {
      transport.infantry = Math.max(0, transport.infantry - (ld.player.convoy || 0));
      const load = result.grainLoad || transport.grainLoad || 0;
      const lost = Math.round(load * (1 - clamp(result.convoyHp || 0, 0, 1)));
      const saved = Math.round(load * clamp(result.convoyHp || 0, 0, 1));
      if (result.win) {
        // 完整交付：护送成功即离境折赋，损毁部分自库存扣除
        S.res.grain = Math.max(0, S.res.grain - lost);
        S.res.gold += Math.round(saved * 0.05);
        transport.grainLoad = 0;
        transport.node = 'dukou';
      } else {
        // 护送失败：残车退回粮道，所存即未损部分
        S.res.grain = Math.max(0, S.res.grain - lost);
        transport.grainLoad = saved;
        transport.node = 'liangdao';
      }
      transport.march = null;
    }
    S.res.troops = countTroops();
    S.epic.push({
      char: 'liulaozhi', node: '渡口护粮', year: S.year,
      text: `${result.win ? '督粮车渡淝水，挫秦军前锋。' : '粮道受阻，敛兵退还东岸。'}（本局推演）`,
    });
    resolveTodo('秋赋护送待定');
    addTodo('report', '渡口战报待阅', '交锋已结算 —— 查看战报与史鉴', 'dukou');
    pushLog(`回合${S.turn - 1} · 交锋`, `渡口护粮之战：我方伤亡${result.losses.player}，敌方伤亡${result.losses.enemy}，辎重保存${Math.round((result.convoyHp || 0) * 100)}%。`);
    S.lastBattleResult = result;
    S.phase = '待阅战报';
    save();
    return true;
  }

  function markReportViewed() {
    if (S.phase === '待阅战报') { S.phase = '筹划'; save(); }
    resolveTodo('渡口战报待阅');
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
      if (!o || (o.version !== 'proto-1.1' && o.version !== 'proto-1.0')) return false;
      if (o.version === 'proto-1.0') return false; // 旧版规则已变，直接弃档
      S = o;
      if (!S.lastBattleResult) S.lastBattleResult = null;
      settleRunner = null;
      if (S.phase === '结算') S.phase = '筹划';
      return true;
    } catch (e) { return false; }
  }
  function hasSave() { try { const r = localStorage.getItem(KEY); if (!r) return false; try { const o = JSON.parse(r); return o.version === 'proto-1.1'; } catch (e) { return false; } } catch (e) { return false; } }
  function clearSave() { try { localStorage.removeItem(KEY); } catch (e) {} }
  function current() { return S; }

  function pushLog(turn, text) {
    S.log.unshift({ turn, text, time: Date.now() });
    if (S.log.length > 60) S.log.pop();
    emit('log');
  }

  return {
    newGame, current, save, load, hasSave, clearSave,
    addOrder, removeOrder, ordersOfLegion, blockingIssues, softWarnings,
    endTurn, takeSettle, settlePending, stanceName, nodeName,
    writeBattleResult, markReportViewed, addTodo, resolveTodo,
    history, SEASONS, BASE_UPKEEP, on, emit,
  };
})();
