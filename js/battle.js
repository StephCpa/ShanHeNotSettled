/* ═══════════════════════════════════════════════════════════
   十六国 · 山河未定 — 关键即时交锋（护粮渡河）
   §09: 上方目标条 / 中央战场 / 下方部队栏(6单位) / 右侧命令区 / 侧边军情(≤2)

   结构：纯数据模拟核心（createSim）+ 表现层绑定。
   亲自指挥与委任将领走同一套战斗规则，只差命令来源：
   - 亲自指挥：玩家逐队下令，实时步进
   - 委任：headless 复跑同一模拟器，按预案自动下令

   进入战场继承战略状态（兵力/士气/疲劳/载粮）；
   完成后一次性产出结果（按类型战损 + 辎重比例），由 State 回写。
   ═══════════════════════════════════════════════════════════ */
window.SHL = window.SHL || {};

SHL.Battle = (function () {
  'use strict';
  const D = SHL.DATA;

  const WORLD = { w: 120, h: 100 };
  const NX = 0.34, NW = 0.045, CY = 0.52, CW = 0.06;  // 淝水与浅滩（归一化）
  const SIM_DT = 1 / 30;   // 固定模拟步长：亲自指挥与委任共用，结果与帧率/倍速无关

  /* ═══════════════ 模拟核心（无渲染依赖） ═══════════════ */
  function nx2wx(nx) { return (nx - 0.5) * WORLD.w; }
  function nz2wz(nz) { return (nz - 0.5) * WORLD.h; }
  function isRiverW(x, z) { const nx = x / WORLD.w + 0.5, nz = z / WORLD.h + 0.5; return Math.abs(nx - NX) < NW && !(Math.abs(nz - CY) < CW); }
  function isShallowW(x, z) { const nx = x / WORLD.w + 0.5, nz = z / WORLD.h + 0.5; return Math.abs(nx - NX) < NW && Math.abs(nz - CY) < CW; }
  function groundYW(x, z, hill) {
    if (isRiverW(x, z)) return -0.55;
    if (isShallowW(x, z)) return -0.28;
    if (hill) {
      const d = Math.hypot(x - nx2wx(hill.x), z - nz2wz(hill.y));
      if (d < 0.09 * WORLD.w) return 2.6 * Math.max(0, 1 - d / (0.09 * WORLD.w));
    }
    return 0;
  }

  function createSim(cfg, input) {
    const hill = cfg.terrain.hill;
    const RIVERWX = nx2wx(NX), CROSSZ = nz2wz(CY);
    const WESTX = (NX - NW - 0.5) * WORLD.w;   // 西岸线：越过此处才算渡过河西
    const EXITX = (cfg.exitZone.x1 - 0.5) * WORLD.w + 4;
    const EXITZ = ((cfg.exitZone.y1 + cfg.exitZone.y2) / 2 - 0.5) * WORLD.h;
    const WINX = (cfg.exitZone.x1 - 0.5) * WORLD.w + 5;
    // 粮车路径节点：东岸入口 → 浅滩中心 → 西岸河道外 → 撤离区
    const WAYPOINTS = [
      { x: -13, z: CROSSZ },
      { x: RIVERWX - 4, z: CROSSZ },
      { x: RIVERWX - 22, z: EXITZ },
      { x: EXITX, z: EXITZ },
    ];

    const units = [];
    function addU(u, side) {
      const col = side === 'player' ? D.factions.jin.color : D.factions.qin.color;
      units.push({
        id: u.id, name: u.name, side,
        type: u.type, isConvoy: !!u.isConvoy, reserve: !!u.reserve,
        hp: u.strength, maxHp: u.strength, dmgTaken: 0,
        morale: u.morale, fatigue: u.fatigue,
        x: (u.start[0] - 0.5) * WORLD.w, z: (u.start[1] - 0.5) * WORLD.h,
        order: u.reserve ? 'reserve' : (u.isConvoy ? 'advance' : 'hold'),
        orderState: '待命', wpIdx: 0, moving: false, routed: false, dead: false,
        speedBase: u.type === 'cavalry' ? 7.5 : u.type === 'wagon' ? 2.2 : u.type === 'archer' ? 4.6 : 5.4,
        range: u.type === 'archer' ? 16 : u.type === 'cavalry' ? 5.5 : 6.5,
        dps: u.type === 'archer' ? 9 : u.type === 'cavalry' ? 14 : 10,
        engagedWith: null, warned: false,
      });
    }

    /* 玩家六队：按战略继承输入缩放 */
    const inf = Math.max(0, Math.round(input.infantry || 0));
    const cav = Math.max(0, Math.round(input.cavalry || 0));
    const arch = Math.max(0, Math.round(input.archer || 0));
    const guards = Math.max(0, Math.round(input.guards || 0));   // 运输队护卫（人数，独立于车耐久）
    const p1 = Math.round(inf * 0.35), p2 = Math.round(inf * 0.35);
    const p5 = Math.max(0, inf - p1 - p2);
    const convoyDur = Math.min(420, Math.max(80, Math.round((input.grainLoad || 0) / 10)));  // 车队耐久（受载量影响，不等于人数）
    const P = { morale: input.morale || 70, fatigue: input.fatigue || 15 };
    const inBy = (id) => cfg.playerUnits.find(u => u.id === id);
    [p1, p2, p5, arch, cav, convoyDur].forEach((v, i) => {
      const tpl = ['p1', 'p2', 'p5', 'p3', 'p4', 'p6'][i];
      const u = { ...inBy(tpl), strength: v, morale: P.morale, fatigue: P.fatigue };
      addU(u, 'player');
    });
    const simConvoy = units.find(u => u.isConvoy);
    if (simConvoy) { simConvoy.guardHp = guards; simConvoy.maxGuard = guards; simConvoy.wagonDmg = 0; }
    cfg.enemyUnits.forEach(u => addU(u, 'enemy'));
    const grainLoad = Math.max(0, Math.round(input.grainLoad || 0));

    const sim = {
      units, grainLoad, time: 0, stage: 0, ended: false, events: [],
      participants: input.participants || [],   // 参战军团ID：回写按此名单
      _alertT: 0, _p3EastT: 0, _p3AllT: 0.0001,
      convoy() { return units.find(u => u.isConvoy); },
      live(id) { const u = units.find(x => x.id === id); return u && !u.dead ? u : null; },

      issue(id, cmd) {
        const u = units.find(x => x.id === id);
        if (!u || u.dead || u.side !== 'player') return false;
        if (u.order === 'reserve') return false;
        if (cmd === 'turn') {
          const th = sim._nearestEnemy(u);
          if (th) { u.faceTo = th; u.orderState = '正在执行'; }
          return true;
        }
        u.order = cmd; u.orderState = '已收到';
        return true;
      },
      deployReserve() {
        const r = units.find(u => u.reserve && u.side === 'player' && !u.dead && u.order === 'reserve');
        if (!r) return false;
        r.order = 'hold'; r.reserve = false; r.orderState = '已收到';
        sim.events.push({ kind: 'sugg', text: r.name + ' 已投入，向东岸缺口展开。' });
        return true;
      },
      _nearestEnemy(u) {
        let best = null, bd = 1e9;
        units.forEach(o => { if (o.side !== u.side && !o.dead && !o.routed) { const d = Math.hypot(u.x - o.x, u.z - o.z); if (d < bd) { bd = d; best = o; } } });
        return best;
      },

      step(dt) {
        if (sim.ended) return null;
        sim.time += dt;
        sim._alertT -= dt;
        units.forEach(u => sim._stepUnit(u, dt));
        sim._checkThreats();
        return sim.checkEnd();
      },

      _stepUnit(u, dt) {
        if (u.dead) return;
        if (u.routed) {
          const dir = u.side === 'player' ? -1 : 1;
          u.x += dir * 8 * dt;
          u.moving = true;
          return;
        }
        // 弩手东岸位统计（假设对照用）
        if (u.id === 'p3') { sim._p3AllT += dt; if (u.x / WORLD.w + 0.5 > NX) sim._p3EastT += dt; }

        let target = null;
        // 车马疲劳减半生效：辎重车再疲惫也能缓慢挪动，不会彻底瘫痪
        const moveSpeed = u.speedBase * (1 - u.fatigue / (u.isConvoy ? 400 : 200));
        const inRiver = isRiverW(u.x, u.z), inShal = isShallowW(u.x, u.z);
        let sp = moveSpeed;
        if (inRiver) sp *= 0.35;
        if (inShal) sp *= 0.6;
        if (sim._inWoods(u.x, u.z)) sp *= 0.7;

        const cv = sim.convoy();
        if (u.side === 'player') {
          if (u.isConvoy) {
            const wp = WAYPOINTS[Math.min(u.wpIdx, WAYPOINTS.length - 1)];
            target = { x: wp.x, z: wp.z };
            if (Math.hypot(u.x - wp.x, u.z - wp.z) < 2.5 && u.wpIdx < WAYPOINTS.length - 1) u.wpIdx++;
            u.moving = true;
          } else if (u.order === 'escort' && cv && !cv.dead) {
            const d = Math.hypot(u.x - cv.x, u.z - cv.z);
            target = d > 8 ? cv : null;
          } else if (u.order === 'advance') {
            const e = sim._nearestEnemy(u);
            if (e && Math.hypot(u.x - e.x, u.z - e.z) > u.range * 0.8) target = e;
            else if (cv && !cv.dead && Math.hypot(u.x - cv.x, u.z - cv.z) > 14) target = cv;
          } else if (u.order === 'retreat') {
            target = { x: 46, z: u.z };
            if (u.x > 44) { u.orderState = '已撤离'; u.safe = true; u.moving = false; return; }
          }
        } else {
          // 敌方AI：优先攻击拦路晋军，无拦截则直扑粮车
          let interceptor = null, id = 1e9;
          units.forEach(o => {
            if (o.side !== 'player' || o.dead || o.routed || o.isConvoy) return;
            const d = Math.hypot(u.x - o.x, u.z - o.z);
            if (d < 22 && d < id) { id = d; interceptor = o; }
          });
          if (interceptor) {
            target = id > u.range * 0.8 ? interceptor : null;
          } else if (cv && !cv.dead) {
            const d = Math.hypot(u.x - cv.x, u.z - cv.z);
            target = d > u.range * 0.7 ? cv : null;
            if (u.type === 'cavalry' && d < 26 && d > 10) target = { x: cv.x + 6, z: cv.z + 10 };
          } else {
            const e = units.find(x => x.side === 'player' && !x.dead && !x.routed);
            if (e) target = e;
          }
        }

        u.moving = !!target;
        if (target) {
          const dx = target.x - u.x, dz = target.z - u.z;
          const d = Math.hypot(dx, dz) || 1;
          if (d > 1.2) {
            const st = sp * dt;
            let npx = u.x + dx / d * st, npz = u.z + dz / d * st;
            if (!u.isConvoy) {
              // 车马沉重：粮车不受推挤；推力按时间计（单位/秒），与步长无关
              units.forEach(o => {
                if (o === u || o.dead) return;
                const dd = Math.hypot(npx - o.x, npz - o.z);
                if (dd < 4.5 && dd > 0.01) {
                  const pushRate = Math.min(4.5 - dd, 1.2);   // ≤1.2 单位/秒
                  npx += (npx - o.x) / dd * pushRate * dt;
                  npz += (npz - o.z) / dd * pushRate * dt;
                }
              });
            }
            u.x = Math.max(-58, Math.min(58, npx));
            u.z = Math.max(-49, Math.min(49, npz));
            u.orderState = '正在执行';
          } else u.orderState = '已到位';
        }

        // 交战（伤害限幅；粮车伤害先由护卫承担，溢出才伤车体——人员与货物分开核算）
        let gave = 0;
        units.forEach(o => {
          if (o.side === u.side || o.dead || o.routed) return;
          const d = Math.hypot(u.x - o.x, u.z - o.z);
          if (d < u.range) {
            const moral = 1 + u.morale / 200;
            const fatigueF = 1 - u.fatigue / 250;
            const charge = u.type === 'cavalry' && u.moving ? 1.5 : 1;
            const dmg = u.dps * moral * fatigueF * charge * dt * 0.5;
            let applied;
            if (o.isConvoy) {
              const toGuard = Math.min(dmg, Math.max(0, o.guardHp));
              o.guardHp -= toGuard;
              const toWagon = dmg - toGuard;
              o.hp -= toWagon;
              o.dmgTaken += toGuard;
              o.wagonDmg = (o.wagonDmg || 0) + toWagon;
              applied = dmg;
            } else {
              applied = Math.min(dmg, Math.max(0, o.hp));
              o.hp -= applied; o.dmgTaken += applied;
            }
            gave += applied;
            u.engagedWith = o; o.engagedWith = u;
          }
        });
        if (gave > 0) u.morale = Math.min(100, u.morale + dt * 0.8);
        const hpFrac = u.hp / u.maxHp;
        if (hpFrac < 0.5) u.morale -= dt * 1.6;
        if (hpFrac < 0.25) u.morale -= dt * 3;
        if (u.fatigue > 70) u.morale -= dt * 0.6;
        if (inRiver || inShal) u.morale -= dt * 0.9;
        u.fatigue = Math.min(100, u.fatigue + dt * (u.moving ? 1.1 : 0.25));

        if (u.morale < 25 && !u.routed && !u.isConvoy) {
          // 车队无士气概念：不溃逃，只可能被摧毁或缓缓前行
          u.routed = true;
          sim.events.push({ kind: 'threat', text: `${u.name} 士气崩溃，正脱离战场！` });
        }
        if (u.hp <= 0) {
          u.dead = true; u.hp = 0;
          if (u.isConvoy) sim.events.push({ kind: 'threat', text: '粮车尽失！辎重已毁。' });
        }
      },

      _inWoods(x, z) {
        const w1 = cfg.terrain.woodsEast, w2 = cfg.terrain.woodsWest;
        return Math.hypot(x - nx2wx(w1[0]), z - nz2wz(w1[1])) < 0.10 * WORLD.w
          || Math.hypot(x - nx2wx(w2[0]), z - nz2wz(w2[1])) < 0.08 * WORLD.w;
      },

      _checkThreats() {
        if (sim._alertT > 0) return;
        sim._alertT = 4;
        const cv = sim.convoy();
        if (cv && !cv.dead) {
          const cav = units.find(u => u.side === 'enemy' && u.type === 'cavalry' && !u.dead && !u.routed);
          if (cav && Math.hypot(cav.x - cv.x, cav.z - cv.z) < 20)
            sim.events.push({ kind: 'threat', text: '敌骑兵正迂回粮车！速令一队拦截。' });
          if (isRiverW(cv.x, cv.z) || isShallowW(cv.x, cv.z)) {
            sim.stage = Math.max(sim.stage, 1);
            if (!cv.warned) { sim.events.push({ kind: 'threat', text: '运输队正在渡河——队列散乱，辎重易受袭。' }); cv.warned = true; }
          }
          if (cv.x < (cfg.exitZone.x1 - 0.5) * WORLD.w + 8) sim.stage = 2;
        }
        const arch = sim.live('p3');
        if (arch && (isRiverW(arch.x, arch.z) || isShallowW(arch.x, arch.z)))
          sim.events.push({ kind: 'sugg', text: '建议：弩手渡河则失林缘之利，宜撤回东岸。' });
      },

      checkEnd() {
        const cv = sim.convoy();
        // 三段判定：抵达撤离区（完整成功）→ 越过西岸线（部分）→ 仍在东岸/河道（未渡）
        const atExit = cv ? cv.x < WINX : false;
        const crossedWest = cv ? cv.x < WESTX : false;
        if (cv && !cv.dead && cv.hp > 0 && atExit)
          return sim._finish(true, '运输队安然渡过淝水，粮道复通。');
        const players = units.filter(u => u.side === 'player');
        const combat = players.filter(u => !u.isConvoy);
        if (!cv || cv.dead) return sim._finish(false, '运输队毁于渡口，粮道中断。');
        if (combat.length && combat.every(u => u.dead || u.routed || u.safe)) {
          if (atExit) return sim._finish(true, '掩护部队虽尽，粮车竟得全而退——虽胜犹惋。');
          if (crossedWest) return sim._finish(false, '掩护尽没，粮车虽已过西岸，然未抵撤离区——任务未竟，残车待收容。', { partial: true });
          return sim._finish(false, '掩护尽没，粮车滞留东岸，终为敌所获。', { convoyOverride: 0 });
        }
        if (sim.time > cfg.timeLimit)
          return sim._finish(false, '时限已至，粮车未及抵达撤离区，都督收兵再图。', { partial: crossedWest });
        return null;
      },

      _finish(win, text, opts) {
        if (sim.ended) return null;
        sim.ended = true;
        opts = opts || {};
        const lossDetail = { player: { infantry: 0, cavalry: 0, archer: 0, guard: 0, wagon: 0 }, enemy: { cavalry: 0, infantry: 0, archer: 0 } };
        units.forEach(u => {
          if (u.side === 'player') {
            if (u.isConvoy) {
              lossDetail.player.guard += Math.round(u.dmgTaken);       // 护卫伤亡（人数）
              lossDetail.player.wagon += Math.round(u.wagonDmg || 0);  // 车体损耗（耐久，不折算人数）
            }
            else if (u.type === 'archer') lossDetail.player.archer += Math.round(u.dmgTaken);
            else if (u.type === 'cavalry') lossDetail.player.cavalry += Math.round(u.dmgTaken);
            else lossDetail.player.infantry += Math.round(u.dmgTaken);
          } else {
            if (u.type === 'cavalry') lossDetail.enemy.cavalry += Math.round(u.dmgTaken);
            else if (u.type === 'archer') lossDetail.enemy.archer += Math.round(u.dmgTaken);
            else lossDetail.enemy.infantry += Math.round(u.dmgTaken);
          }
        });
        const playerTotal = lossDetail.player.infantry + lossDetail.player.cavalry + lossDetail.player.archer + lossDetail.player.guard;
        const enemyTotal = lossDetail.enemy.cavalry + lossDetail.enemy.infantry + lossDetail.enemy.archer;
        const cv = sim.convoy();
        const convoyHp = opts.convoyOverride != null ? opts.convoyOverride : (cv ? Math.max(0, cv.hp / cv.maxHp) : 0);
        const enemyInit = cfg.enemyUnits.reduce((s, u) => s + u.strength, 0);
        const enemyAlive = units.filter(u => u.side === 'enemy' && !u.dead).reduce((s, u) => s + u.hp, 0);
        const result = {
          win, text,
          partial: !!opts.partial,
          participants: sim.participants,
          losses: { player: playerTotal, enemy: enemyTotal },
          lossDetail,
          wounded: Math.round(playerTotal * 0.25),
          convoyHp, grainLoad: sim.grainLoad,
          time: Math.round(sim.time),
          archerEast: sim._p3EastT / sim._p3AllT,
          assumptions: [
            { k: '「敌约三千，无浮桥」', ok: enemyInit < 2400, note: enemyInit < 2400 ? '与侦报相符' : '实测敌锋较侦报更多，情报低估' },
            { k: '「浅滩可快速通过」', ok: convoyHp > 0.4, note: convoyHp > 0.4 ? '浅滩通过顺利' : '浅滩一度受阻，辎重损失明显' },
            { k: '「林缘可覆盖渡口」', ok: sim._p3EastT / sim._p3AllT > 0.6, note: sim._p3EastT / sim._p3AllT > 0.6 ? '弩手保持东岸位，火力覆盖实现' : '弩手脱离掩护位，火力中断' },
          ],
        };
        return result;
      },
    };
    return sim;
  }

  /* ═══════════════ 战略输入推导（按接敌时的参战名单） ═══════════════ */
  function deriveInput(S) {
    const t = S.legions.transport;
    // 只有此刻已抵达渡口的战斗军团才参战；运输队为触发者，仅提供载粮与护卫
    const parts = ['beifu', 'bagongshan', 'scouts'].filter(id => S.legions[id] && S.legions[id].node === 'dukou');
    let infantry = 0, cavalry = 0, archer = 0, m = 0, f = 0, n = 0;
    parts.forEach(id => {
      const L = S.legions[id];
      infantry += L.infantry; cavalry += L.cavalry; archer += L.archer;
      m += L.morale; f += L.fatigue; n++;
    });
    return {
      participants: parts,
      infantry, cavalry, archer,
      guards: t ? (t.infantry || 0) : 0,   // 运输队护卫人数（独立于车耐久）
      morale: n ? Math.round(m / n) : 70,
      fatigue: n ? Math.round(f / n) : 15,
      grainLoad: t ? (t.grainLoad || 0) : 0,
    };
  }
  function assessPlayerForce(S) {
    const i = deriveInput(S);
    const total = i.infantry + i.cavalry + i.archer;
    return { total, canLiveCommand: total >= 120, grainLoad: i.grainLoad, participants: i.participants };
  }

  /* ═══════════════ 委任：headless 复跑同一模拟器（同一固定步长） ═══════════════ */
  function simulateDelegated(input) {
    const cfg = D.battleDukou;
    const sim = createSim(cfg, input);
    // 都督预案：步弩据东岸浅滩两翼，骑兵迂回拦截，粮车按节点渡河，预备队相机投入
    sim.issue('p4', 'advance');
    sim.deployReserve();
    let result = null;
    let guard = 0;
    const maxSteps = Math.ceil((cfg.timeLimit + 60) / SIM_DT);
    while (!result && guard++ < maxSteps) {
      result = sim.step(SIM_DT);
    }
    if (!result) result = sim._finish(false, '时限已至，粮车未及抵达撤离区，都督收兵再图。', { partial: sim.convoy() ? sim.convoy().x < (NX - NW - 0.5) * WORLD.w : false });
    result.delegated = true;
    return result;
  }

  /* ═══════════════ 交互层（渲染 / 输入 / 计时） ═══════════════ */
  let renderer, scene, camera, canvas, raycaster;
  let sim = null, cfg = null, view = null;
  let running = false, paused = false, speed = 1, lastSpeed = 1;
  let selected = null, onResult = null, raf = 0, alive = false, ended = false;
  let labelHost, alerts = [], lastResult = null;
  let _clock = performance.now();

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const STAGES = ['第一阶段 · 接敌', '第二阶段 · 抢渡', '第三阶段 · 脱离'];

  function start(opts) {
    cfg = D.battleDukou;
    onResult = opts.onResult;
    const S = SHL.State.current();
    const input = deriveInput(S);
    sim = createSim(cfg, input);
    ended = false; elapsedShownReset(); paused = false; speed = 1; lastSpeed = 1;
    alerts = []; selected = null; lastResult = null;

    canvas = document.getElementById('bt-gl');
    labelHost = document.getElementById('bt-labels');
    labelHost.innerHTML = '';
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xE9E1CB);
    scene.fog = new THREE.Fog(0xE9E1CB, 60, 190);
    scene.add(new THREE.HemisphereLight(0xFFF8E8, 0x9A8C6E, 1.15));
    const sun = new THREE.DirectionalLight(0xFFF2D8, 0.85); sun.position.set(30, 60, 20); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xF2E8D0, 0.3); fill.position.set(-40, 40, -50); scene.add(fill);

    buildTerrain();
    view = {};
    sim.units.forEach(u => { view[u.id] = makeUnitView(u); });
    camera = new THREE.PerspectiveCamera(44, 2, 0.1, 500);
    camera.position.set(28, 34, 62);
    camera.lookAt(0, 0, 0);
    raycaster = new THREE.Raycaster();
    bindInput();
    resize();
    buildUnitBar();
    setAlert('敌前锋自西岸渡口以东集结，正寻我粮车。', 'threat');
    setAlert('建议：弩手据东岸林缘，可覆盖浅滩。', 'sugg');
    updateGoal();
    alive = true; running = true;
    _clock = performance.now();
    loop();
  }
  function elapsedShownReset() { document.getElementById('bt-timer').textContent = '00:00'; }

  /* ── 战场地形（表现） ── */
  function buildTerrain() {
    const geo = new THREE.PlaneGeometry(WORLD.w, WORLD.h, 60, 50);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cLow = new THREE.Color(0xD5CBAE), cGrass = new THREE.Color(0x9FA489), cSand = new THREE.Color(0xC9BC97);
    const hill = cfg.terrain.hill;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const isR = isRiverW(x, z), isS = isShallowW(x, z);
      let y = 0;
      if (isR) y = -0.6; else if (isS) y = -0.3;
      const hd = Math.hypot(x - (hill.x - 0.5) * WORLD.w, z - (hill.y - 0.5) * WORLD.h);
      if (hd < 0.09 * WORLD.w) y = 2.8 * Math.max(0, 1 - hd / (0.09 * WORLD.w));
      pos.setY(i, y);
      const c = (isR || isS) ? cSand.clone().lerp(new THREE.Color(0x54768A), 0.6)
        : cLow.clone().lerp(cGrass, (Math.sin(x / WORLD.w * 40) * Math.cos(z / WORLD.h * 30) + 1) / 2 * 0.5);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
    const water = new THREE.Mesh(new THREE.PlaneGeometry(NW * 2 * WORLD.w + 1, WORLD.h), new THREE.MeshBasicMaterial({ color: 0x47707F, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(nx2wx(NX), -0.35, 0);
    scene.add(water);
    for (let i = 0; i < 5; i++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 2.2), new THREE.MeshLambertMaterial({ color: 0x9C8665 }));
      st.position.set(nx2wx(NX) + (i % 2 ? 1.4 : -1.4), -0.25, nz2wz(CY) + (i - 2) * 2.2);
      scene.add(st);
    }
    const tgeo = new THREE.ConeGeometry(1.1, 3.4, 5);
    const tmat = new THREE.MeshLambertMaterial({ color: 0x4A554A, flatShading: true });
    const inst = new THREE.InstancedMesh(tgeo, tmat, 130);
    const m4 = new THREE.Matrix4();
    let k = 0;
    const rr = mulberry32(cfg.seed);
    [cfg.terrain.woodsEast, cfg.terrain.woodsWest].forEach(w => {
      for (let i = 0; i < 65; i++) {
        const a = rr() * Math.PI * 2, d = Math.sqrt(rr()) * (w === cfg.terrain.woodsEast ? 0.10 : 0.08) * WORLD.w;
        const x = (w[0] - 0.5) * WORLD.w + Math.cos(a) * d, z = (w[1] - 0.5) * WORLD.h + Math.sin(a) * d * 0.83;
        if (isRiverW(x, z)) continue;
        const s = 0.55 + rr() * 0.5;
        m4.makeScale(s, s, s);
        m4.setPosition(x, 2.2 * s, z);
        inst.setMatrixAt(k++, m4);
      }
    });
    inst.count = k;
    scene.add(inst);
    const ez = cfg.exitZone;
    const exitPlane = new THREE.Mesh(new THREE.PlaneGeometry(9, 28), new THREE.MeshBasicMaterial({ color: 0x75816B, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    exitPlane.rotation.x = -Math.PI / 2;
    exitPlane.position.set((ez.x1 - 0.5) * WORLD.w + 4.5, 0.06, ((ez.y1 + ez.y2) / 2 - 0.5) * WORLD.h);
    scene.add(exitPlane);
    const exitRing = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.18, 6, 24), new THREE.MeshBasicMaterial({ color: 0x4F5A4A }));
    exitRing.rotation.x = Math.PI / 2;
    exitRing.position.set(exitPlane.position.x, 0.12, exitPlane.position.z);
    scene.add(exitRing);
  }

  /* ── 单位视图 ── */
  function makeUnitView(u) {
    const col = u.side === 'player' ? D.factions.jin.color : D.factions.qin.color;
    const color = new THREE.Color(col);
    const g = new THREE.Group();
    const cnt = u.type === 'wagon' ? 5 : u.maxHp > 300 ? 12 : 9;
    const mat = new THREE.MeshLambertMaterial({ color: color.getHex(), flatShading: true, transparent: u.reserve, opacity: u.reserve ? 0.55 : 1, wireframe: false });
    const geo = new THREE.ConeGeometry(0.5, 1.7, 5);
    const inst = new THREE.InstancedMesh(geo, mat, cnt);
    const m4 = new THREE.Matrix4();
    const rnd = mulberry32(u.id.charCodeAt(1) * 31 + 7);
    for (let i = 0; i < cnt; i++) {
      const a = i / cnt * Math.PI * 2, r = 1.6 + rnd() * 2.2;
      m4.makeRotationY(rnd() * 6);
      m4.setPosition(Math.cos(a) * r, 0.85, Math.sin(a) * r);
      inst.setMatrixAt(i, m4);
    }
    g.add(inst);
    if (u.isConvoy) {
      for (let i = 0; i < 3; i++) {
        const cart = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 1.5), new THREE.MeshLambertMaterial({ color: 0x7A6448 }));
        cart.position.set(-1 + i * 2.2, 0.7, 2.6);
        g.add(cart);
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.2, 8), new THREE.MeshLambertMaterial({ color: 0x3A403D }));
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(-1 + i * 2.2, 0.5, 3.5);
        g.add(wheel);
      }
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 5), new THREE.MeshLambertMaterial({ color: 0x3A403D }));
    pole.position.set(0, 3, -1.4);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5, 4, 2), new THREE.MeshBasicMaterial({ color: color.getHex(), side: THREE.DoubleSide, transparent: u.reserve, opacity: u.reserve ? 0.55 : 1 }));
    flag.position.set(1.2, 5.2, -1.4);
    g.add(pole); g.add(flag);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.14, 6, 26), new THREE.MeshBasicMaterial({ color: 0x984C3F, transparent: true, opacity: 0 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.15;
    g.add(ring);
    scene.add(g);
    g.userData.unitId = u.id;

    const label = document.createElement('div');
    label.className = 'map-label legion';
    label.style.borderColor = col;
    label.style.color = col;
    labelHost.appendChild(label);
    return { group: g, flag, ring, label };
  }

  function syncView() {
    sim.units.forEach(u => {
      const v = view[u.id];
      if (!v) return;
      if (u.dead) { v.group.visible = false; v.label.style.display = 'none'; return; }
      v.group.visible = true;
      v.group.position.set(u.x, groundYW(u.x, u.z, cfg.terrain.hill), u.z);
      v.group.rotation.y = u.moving && v._lastTarget ? 0 : v.group.rotation.y;
      v.ring.material.opacity = (u.id === selected && u.side === 'player') ? 0.9 : 0;
      const t = performance.now() / 1000;
      v.flag.rotation.y = Math.sin(t * 2 + u.maxHp) * 0.2;
      v.flag.position.x = 1.2 + Math.sin(t * 2.4) * 0.1;
      const p = v.group.position;
      const w = p.clone(); w.y += 7; w.project(camera);
      const r = canvas.getBoundingClientRect();
      if (w.z > 1) { v.label.style.display = 'none'; return; }
      v.label.style.display = 'block';
      v.label.style.transform = `translate(-50%,-100%) translate(${(w.x * 0.5 + 0.5) * r.width}px,${(-w.y * 0.5 + 0.5) * r.height}px)`;
      v.label.textContent = u.name + ' ' + Math.max(0, Math.round(u.hp)) + (u.routed ? ' · 溃退' : '');
    });
  }

  /* ── 输入 ── */
  function bindInput() {
    const center = new THREE.Vector3(0, 0, 0);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    let bdrag = false, bx = 0;
    canvas.addEventListener('mousedown', e => { if (e.button === 2) { bdrag = true; bx = e.clientX; } });
    window.addEventListener('mouseup', () => bdrag = false);
    window.addEventListener('mousemove', e => {
      if (bdrag && camera) {
        camera.position.sub(center).applyAxisAngle(new THREE.Vector3(0, 1, 0), (e.clientX - bx) * 0.004).add(center);
        bx = e.clientX;
        camera.lookAt(center);
      }
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      if (!camera) return;
      const f = 1 + Math.sign(e.deltaY) * 0.08;
      camera.position.sub(center).multiplyScalar(f).add(center);
    }, { passive: false });
    canvas.onmousedown = (e) => {
      if (e.button !== 0) return;
      const r = canvas.getBoundingClientRect();
      const nxp = ((e.clientX - r.left) / r.width) * 2 - 1;
      const nyp = -((e.clientY - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(nxp, nyp), camera);
      const ids = sim.units.filter(u => u.side === 'player' && !u.dead).map(u => u.id);
      const groups = ids.map(id => view[id].group);
      const hits = raycaster.intersectObjects(groups, true);
      if (hits.length) {
        let o = hits[0].object;
        while (o.parent && !o.userData.unitId) o = o.parent;
        if (o && o.userData.unitId) { selectUnit(o.userData.unitId); SHL.Audio.tick(); }
      }
    };
    window.addEventListener('keydown', onKey);
  }
  function onKey(e) {
    if (!running) return;
    if (e.code === 'Space') { e.preventDefault(); setSpeed(paused ? lastSpeed || 1 : 0); }
  }

  /* ── UI ── */
  function buildUnitBar() {
    const bar = document.getElementById('bt-units');
    bar.innerHTML = '';
    sim.units.filter(u => u.side === 'player').forEach(u => {
      const el = document.createElement('div');
      el.className = 'bt-unit';
      el.id = 'bu-' + u.id;
      el.innerHTML = `
        <h5><span>${u.name}</span><span class="u-strength">${Math.round(u.hp)}</span></h5>
        <div class="u-bars">
          <div class="u-bar m"><i style="width:${u.morale}%"></i></div>
          <div class="u-bar f"><i style="width:${u.fatigue}%"></i></div>
        </div>
        <div class="u-order">${orderLabel(u)}</div>`;
      el.addEventListener('click', () => { selectUnit(u.id); SHL.Audio.tick(); });
      bar.appendChild(el);
    });
    document.getElementById('btc-title').textContent = '军令 —— ' + cfg.commanderName + ' · 护粮都督';
    buildCmdBtns();
  }
  function orderLabel(u) {
    const map = { hold: '坚守', advance: '推进', escort: '护卫粮车', turn: '转向', retreat: '撤退', reserve: '预备队' };
    const s = u.orderState === '受阻' ? ' · 受阻' : (u.moving && u.order !== 'reserve' ? ' · 正在执行' : u.order !== 'reserve' ? ' · 已收到' : '');
    return (map[u.order] || u.order) + (u.order === 'reserve' ? '（未投入）' : s);
  }

  const CMDS = [
    { id: 'hold', name: '坚守', key: '1', desc: '就地列阵，不主动接敌' },
    { id: 'advance', name: '推进', key: '2', desc: '向前接敌 / 随粮车前进' },
    { id: 'escort', name: '护粮', key: '3', desc: '贴近运输队行进' },
    { id: 'turn', name: '转向', key: '4', desc: '面向最近威胁列阵' },
    { id: 'retreat', name: '撤退', key: '5', desc: '向东岸脱离接触' },
    { id: 'deploy', name: '预备队', key: '6', desc: '投入未展开之预备队' },
  ];
  function buildCmdBtns() {
    const box = document.getElementById('btc-btns');
    box.innerHTML = '';
    CMDS.forEach(c => {
      const b = document.createElement('button');
      b.className = 'btn';
      b.innerHTML = `${c.name}<span class="b-key">${c.key}</span>`;
      b.title = c.desc;
      b.onclick = () => issue(c.id);
      b.dataset.cmd = c.id;
      box.appendChild(b);
    });
  }
  function issue(cmd) {
    if (ended) return;
    SHL.Audio.confirm();
    if (cmd === 'deploy') {
      if (!sim.deployReserve()) setAlert('预备队已全部投入，或已接战。', 'sugg');
      refreshCmdBtns(); refreshUnitBar();
      return;
    }
    if (!selected) { setAlert('先在部队栏或战场中选择一支队伍。', 'sugg'); return; }
    const ok = sim.issue(selected, cmd);
    if (!ok) { const u = sim.units.find(x => x.id === selected); setAlert((u ? u.name : '该队') + ' 尚为预备队，需先「投入预备队」。', 'sugg'); return; }
    refreshCmdBtns(); refreshUnitBar();
  }
  function refreshCmdBtns() {
    document.querySelectorAll('#btc-btns .btn').forEach(b => {
      const u = sim.units.find(x => x.id === selected);
      b.classList.toggle('selected', u && b.dataset.cmd === u.order);
    });
  }
  function selectUnit(id) {
    selected = id;
    refreshCmdBtns(); refreshUnitBar();
  }
  function refreshUnitBar() {
    sim.units.filter(u => u.side === 'player').forEach(u => {
      const el = document.getElementById('bu-' + u.id);
      if (!el) return;
      el.querySelector('.u-strength').textContent = Math.max(0, Math.round(u.hp));
      el.querySelector('.u-bar.m i').style.width = Math.max(0, u.morale) + '%';
      el.querySelector('.u-bar.f i').style.width = u.fatigue + '%';
      const o = el.querySelector('.u-order');
      o.textContent = orderLabel(u);
      o.className = 'u-order' + (u.orderState === '受阻' ? ' stuck' : u.moving ? ' exec' : '');
      el.classList.toggle('selected', selected === u.id);
      el.classList.toggle('dead', u.dead);
    });
  }
  function updateGoal() {
    document.getElementById('bt-goal-text').textContent = cfg.objective;
    document.getElementById('bt-goal-opt').textContent = cfg.objectiveOpt;
    document.getElementById('bt-stage').textContent = STAGES[Math.min(2, sim.stage)];
  }
  function setAlert(text, kind) {
    alerts.unshift({ text, kind });
    if (alerts.length > 2) alerts.pop();
    document.getElementById('bt-intel-list').innerHTML =
      alerts.map(a => `<div class="bt-alert ${a.kind === 'sugg' ? 'sugg' : ''}">${a.text}</div>`).join('');
  }
  function setSpeed(v) {
    if (v === 0) paused = true;
    else { paused = false; speed = v; lastSpeed = v; }
    document.querySelectorAll('.bt-speed').forEach(b => b.classList.toggle('active', Number(b.dataset.speed) === (paused ? 0 : speed)));
    document.querySelector('.bt-speed[data-speed="0"]').textContent = paused ? '继续 (空格)' : '暂停 (空格)';
  }

  /* ── 结算展示 ── */
  function showResult(result) {
    ended = true; running = false;
    lastResult = result;
    document.getElementById('btr-body').innerHTML = `
      <p><b>${result.text}</b></p>
      <p>用时 ${fmt(result.time)} · 我方伤亡 <b class="num-neg">${result.losses.player}</b> · 敌方伤亡 <b class="num-pos">${result.losses.enemy}</b></p>
      <p>辎重保存 <b>${Math.round(result.convoyHp * 100)}%</b> · 伤员 ${result.wounded} 人</p>
      <p class="dim">本结果由战斗规则产生；AI 仅解释原方案假设的成立与否。</p>`;
    document.getElementById('bt-result').classList.remove('hidden');
    SHL.Audio.turn();
  }
  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'btr-ok') {
      document.getElementById('bt-result').classList.add('hidden');
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      const result = lastResult;
      lastResult = null;
      if (onResult && result) onResult(result);
    }
  });
  function fmt(s) { return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }

  /* ── 主循环：固定步长累积器驱动，渲染单独更新 ── */
  let acc = 0;
  function loop() {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    const rawDt = Math.min(0.05, (now - _clock) / 1000);
    _clock = now;
    if (!ended) {
      acc += paused ? 0 : rawDt * speed;
      let steps = 0;
      while (acc >= SIM_DT && steps < 8 && !ended) {
        acc -= SIM_DT; steps++;
        const result = sim.step(SIM_DT);
        while (sim.events.length) {
          const ev = sim.events.shift();
          setAlert(ev.text, ev.kind);
          if (ev.kind === 'threat') SHL.Audio.alert();
        }
        if (result) { showResult(result); break; }
      }
      if (acc > SIM_DT * 8) acc = 0;   // 积压过多时丢弃，避免螺旋追赶
      if (steps) {
        refreshUnitBar();
        updateGoal();
        document.getElementById('bt-timer').textContent = fmt(sim.time);
      }
    }
    syncView();
    renderer.render(scene, camera);
  }

  function resize() {
    if (!renderer) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  return {
    start, resize, setSpeed,
    simulateDelegated, deriveInput, assessPlayerForce,
    _createSim: createSim,   // 调试与测试用
    get running() { return running; },
  };
})();
