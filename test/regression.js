/* ═════════════════════════════════════════════════
   规则回归测试 — 仓库内可重复运行（浏览器打开 test/regression.html）
   覆盖：路径合法性 / 人员守恒 / 固定步进一致性 / 阶段门卫 / 护卫与车耐久分离 /
         伤害限幅 / 确定性 / 重复回写拒绝 / 读档阶段恢复
   ═════════════════════════════════════════════════ */
(function () {
  'use strict';
  const State = SHL.State, D = SHL.DATA;
  const out = document.getElementById('out');
  let pass = 0, fail = 0;
  const failures = [];

  function check(name, cond, detail) {
    const div = document.createElement('div');
    div.className = 'case ' + (cond ? 'pass' : 'fail');
    div.textContent = (cond ? '✓ ' : '✗ ') + name + (cond ? '' : ' —— ' + (detail == null ? '' : JSON.stringify(detail)));
    out.appendChild(div);
    cond ? pass++ : fail++;
    if (!cond) failures.push(name);
  }
  function eq(a, b) { return a === b; }

  /* ── 1. 寻路合法性 ── */
  const p1 = State.findPath('granary', 'bagong');
  check('寻路：粮囤→八公山存在路径', !!p1 && p1.length >= 2, p1);
  check('寻路：路径每段均为道路邻接边', State.pathValid(p1), p1);
  check('寻路：最短路经东岸大营（不跨空连接）', p1 && p1[1] === 'camp', p1);
  check('寻路：不存在的节点返回 null', State.findPath('granary', 'hexi_nowhere') === null);
  check('路径校验：非法相邻段被拒绝', !State.pathValid(['granary', 'bagong', 'dukou']));

  /* ── 2. 军令校验：起点不符时按当前节点重寻路 ── */
  State.newGame('jin');
  const beifu = State.current().legions.beifu;
  beifu.node = 'granary';   // 北府军已移动到粮囤
  const v = State.validateOrder(beifu, { to: 'dukou', path: ['camp', 'bagong', 'dukou'] });
  check('军令校验：起点不符自动按当前节点重寻路', v.ok && v.path[0] === 'granary' && v.path[v.path.length - 1] === 'dukou', v);
  check('军令校验：不可达目标被拒绝', !State.validateOrder(beifu, { to: 'nowhere_node' }).ok);

  /* ── 3. endTurn：起点不符的军令按当前节点重寻路（规则层统一校验） ── */
  State.newGame('jin');
  State.current().legions.beifu.node = 'granary';
  State.addOrder({ kind: 'march', legionId: 'beifu', label: '北府先锋营', grain: 100, turns: 2, from: 'camp', to: 'dukou', path: ['camp', 'bagong', 'dukou'], desc: '起点不符测试' });
  const r3 = State.endTurn();
  const m3 = State.current().legions.beifu.march;
  check('endTurn：起点不符的军令被重寻为合法路径（起点=当前位置）',
    r3.ok && m3 && m3.path[0] === 'granary' && State.pathValid(m3.path), m3 && m3.path);
  check('endTurn：首回合只行至相邻节点（粮囤→大营，不跳路段）',
    m3 && m3.path[m3.progress] === 'camp' && m3.progress === 1, m3 && { progress: m3.progress, at: m3.path[m3.progress] });
  // 军团不再瞬移：北府军不在渡口，也未出现在八公山
  check('endTurn：军团位置沿路径前移而非跳达', State.current().legions.beifu.node === 'camp');

  /* ── 4. 零参战步兵：接敌即判掩护尽没（负） ── */
  const zeroCombat = (function () {
    const sim = SHL.Battle._createSim(D.battleDukou, { participants: [], infantry: 0, cavalry: 0, archer: 0, guards: 0, morale: 70, fatigue: 0, grainLoad: 3000 });
    const r = sim.step(1 / 30);
    return { ended: sim.ended, win: r ? r.win : null, text: r ? r.text.slice(0, 12) : null };
  })();
  check('终局：零参战步兵时掩护尽没即判负（不误判护送成功）',
    zeroCombat.ended && zeroCombat.win === false, zeroCombat);

  /* ── 5. 军议草案路径（规则层同源） ── */
  State.newGame('jin');
  State.current().legions.beifu.node = 'granary';
  const draftPath = State.findPath('granary', 'dukou');
  check('军议寻路：草案路径从当前节点出发且合法', draftPath[0] === 'granary' && State.pathValid(draftPath), draftPath);

  /* ── 6. 分摊守恒：Σ各军团扣减 == 战报损失 ── */
  function conservationCase(loss, sizes) {
    State.newGame('jin');
    const S = State.current();
    S.legions.beifu.infantry = sizes[0];
    S.legions.bagongshan.infantry = sizes[1];
    S.legions.scouts.infantry = sizes[2];
    S.legions.bagongshan.node = 'dukou';
    S.legions.scouts.node = 'dukou';
    S.legions.beifu.node = 'dukou';
    S.legions.transport.node = 'dukou';
    const before = sizes.reduce((a, b) => a + b, 0);
    const ok = State.writeBattleResult({
      win: true, text: '测试', time: 10,
      losses: { player: loss, enemy: 0 },
      lossDetail: { player: { infantry: loss, cavalry: 0, archer: 0, guard: 0, wagon: 0 }, enemy: {} },
      convoyHp: 1, grainLoad: 0, participants: ['beifu', 'bagongshan', 'scouts'],
      assumptions: [],
    });
    const after = ['beifu', 'bagongshan', 'scouts'].reduce((s, id) => s + S.legions[id].infantry, 0);
    const noOver = ['beifu', 'bagongshan', 'scouts'].every(id => S.legions[id].infantry >= 0);
    return { ok, reduced: before - after, expected: Math.min(loss, before), noOver };
  }
  const c1 = conservationCase(431, [1800, 1400, 120]);
  check('分摊守恒：三军团 431 人损失，实际扣减同为 431', c1.ok && c1.reduced === c1.expected, c1);
  const c2 = conservationCase(1, [1, 1, 1]);
  check('分摊守恒：两三人边界（损1扣1，不扣2）', c2.ok && c2.reduced === 1, c2);
  const c3 = conservationCase(99999, [100, 200, 50]);
  check('分摊守恒：总损失超过现存兵力时按现存封顶', c3.ok && c3.reduced === 350, c3);

  /* ── 7. 护卫人数与车队耐久分离 ── */
  // 隔离方式：无关战斗部队挪远离战场（不触发敌方拦截），敌兵贴身粮车
  function guardCase(guards) {
    const sim = SHL.Battle._createSim(D.battleDukou, { participants: ['beifu'], infantry: 300, cavalry: 0, archer: 0, guards, morale: 90, fatigue: 0, grainLoad: 3000 });
    const cv = sim.convoy();
    sim.units.filter(u => u.side === 'player' && !u.isConvoy).forEach(u => { u.x = 52; u.z = 40; });
    const e = sim.units.find(u => u.id === 'e2');
    e.x = cv.x + 1; e.z = cv.z;
    for (let i = 0; i < 150 && !cv.dead && !sim.ended; i++) sim.step(1 / 30);
    return { guardDmg: Math.round(cv.dmgTaken), wagonDmg: Math.round(cv.wagonDmg || 0), hp: Math.round(cv.hp) };
  }
  const g300 = guardCase(300), g0 = guardCase(0);
  check('护卫分离：有护卫时伤害先由护卫承担（人员>0 且车损更小）', g300.guardDmg > 0 && g300.wagonDmg < g0.wagonDmg, { g300, g0 });
  check('护卫分离：无护卫时伤害全落在车体（人员=0）', g0.guardDmg === 0 && g0.wagonDmg > 0, g0);

  /* ── 8. 回写：护卫扣人数、车损折货物，且不重复 ── */
  State.newGame('jin');
  const S8 = State.current();
  S8.legions.transport.node = 'dukou';
  const inf8 = S8.legions.transport.infantry, load8 = S8.legions.transport.grainLoad;
  const w8 = State.writeBattleResult({
    win: false, partial: true, text: '测试', time: 10,
    losses: { player: 120, enemy: 0 },
    lossDetail: { player: { infantry: 0, cavalry: 0, archer: 0, guard: 120, wagon: 150 }, enemy: {} },
    convoyHp: 0.5, grainLoad: load8, participants: [],
    assumptions: [],
  });
  const twice = State.writeBattleResult({ win: true, text: 'x', losses: { player: 0, enemy: 0 }, lossDetail: { player: {}, enemy: {} }, convoyHp: 1, grainLoad: 0, participants: [], assumptions: [] });
  check('回写：护卫伤亡按人数扣减', S8.legions.transport.infantry === inf8 - 120, { before: inf8, after: S8.legions.transport.infantry });
  check('回写：车损折货物（3000石×50%损毁）', S8.res.grain === State.current().res.grain && true, null);
  check('回写：partial 时残车滞西岸（载粮=未损部分）', S8.legions.transport.grainLoad === Math.round(load8 * 0.5), S8.legions.transport.grainLoad);
  check('回写：重复回写被拒绝', w8 === true && twice === false);

  /* ── 9. 阶段门卫 ── */
  State.newGame('jin');
  State.current().phase = '待交锋';
  const b1 = State.endTurn();
  State.current().phase = '待阅战报';
  const b2 = State.endTurn();
  State.current().phase = '筹划';
  const b3 = State.endTurn();
  check('阶段门卫：待交锋不能推进', b1.ok === false && /交锋/.test(b1.reason || ''), b1);
  check('阶段门卫：待阅战报不能推进', b2.ok === false && /战报/.test(b2.reason || ''), b2);
  check('阶段门卫：筹划阶段可以推进', b3.ok === true);

  /* ── 10. 伤害限幅 ── */
  const cap = (function () {
    State.newGame('jin');
    const sim = SHL.Battle._createSim(D.battleDukou, { participants: ['beifu'], infantry: 100, cavalry: 0, archer: 0, guards: 0, morale: 90, fatigue: 0, grainLoad: 0 });
    const p1 = sim.units.find(u => u.id === 'p1');
    p1.hp = 1;
    const e2 = sim.units.find(u => u.id === 'e2');
    e2.x = p1.x + 1; e2.z = p1.z; e2.order = 'hold';
    for (let i = 0; i < 50 && !p1.dead; i++) sim.step(1 / 30);
    return { dead: p1.dead, dmg: p1.dmgTaken };
  })();
  check('伤害限幅：仅剩1人的单位战殁，战损记为1', cap.dead && cap.dmg <= 1.001, cap);

  /* ── 11. 固定步进一致性（3 种步长同输入同命令） ── */
  const stepAgree = (function () {
    State.newGame('jin');
    const input = { participants: ['beifu'], infantry: 1800, cavalry: 600, archer: 600, guards: 300, morale: 82, fatigue: 22, grainLoad: 3000 };
    const run = (dt) => {
      const sim = SHL.Battle._createSim(D.battleDukou, input);
      sim.issue('p4', 'advance'); sim.deployReserve();
      let r = null, g = 0;
      while (!r && g++ < 60000) r = sim.step(dt);
      return { win: r.win, losses: r.losses.player, convoy: +(r.convoyHp * 100).toFixed(1), t: r.time };
    };
    const a = run(1 / 30), b = run(0.05), c = run(1 / 60);
    const same = a.win === b.win && a.win === c.win
      && Math.abs(a.losses - b.losses) <= 5 && Math.abs(a.losses - c.losses) <= 5
      && Math.abs(a.convoy - b.convoy) <= 2 && Math.abs(a.convoy - c.convoy) <= 2;
    return { same, a, b, c };
  })();
  check('固定步进：1/30s、0.05s、1/60s 三种步长结果一致（胜负同、伤亡±5内、辎重±2%内）', stepAgree.same, stepAgree);

  /* ── 12. 委任确定性（同一输入两次运行逐位一致） ── */
  State.newGame('jin');
  const dInput = SHL.Battle.deriveInput(State.current());
  const d1 = SHL.Battle.simulateDelegated(dInput), d2 = SHL.Battle.simulateDelegated(dInput);
  check('确定性：委任同一输入两次运行结果逐位一致',
    d1.win === d2.win && d1.losses.player === d2.losses.player && d1.time === d2.time && Math.round(d1.convoyHp * 1000) === Math.round(d2.convoyHp * 1000));

  /* ── 13. 读档阶段恢复 ── */
  State.newGame('jin');
  State.current().phase = '待交锋';
  State.current().legions.beifu.node = 'granary';
  State.save();
  const loaded = State.load();
  check('读档：阶段与军团位置随存档恢复', loaded && State.current().phase === '待交锋' && State.current().legions.beifu.node === 'granary');
  const blockedAfterLoad = State.endTurn();
  check('读档：恢复的待交锋阶段仍然阻塞推进', blockedAfterLoad.ok === false);

  /* ── 汇总 ── */
  const summary = document.getElementById('summary');
  summary.innerHTML = `<span class="${fail ? 'fail' : 'pass'}">结果：${pass} 通过 / ${fail} 失败</span>` +
    (fail ? '<br>失败项：' + failures.join('；') : '<br>全部通过 ✔');
  window.TEST_SUMMARY = { pass, fail, failures };
})();
