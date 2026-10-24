/* ═══════════════════════════════════════════════════════════
   十六国 · 山河未定 — 关键即时交锋（护粮渡河）
   §09: 上方目标条 / 中央战场 / 下方部队栏(6单位) / 右侧命令区 / 侧边军情(≤2)
   战术暂停 + 0.5/1/2倍速；进入战场继承兵力士气疲劳补给天气；
   自动处理与亲自指挥共用战斗模型；完成后只回写一次。
   ═══════════════════════════════════════════════════════════ */
window.SHL = window.SHL || {};

SHL.Battle = (function () {
  'use strict';
  const D = SHL.DATA;

  let renderer, scene, camera, canvas, raycaster;
  let running = false, paused = false, speed = 1, elapsed = 0;
  let units = [], selected = null, cfg = null;
  let onResult = null;
  let raf = 0, alive = false;
  let labelHost, alerts = [];
  let lastResult = null;
  let grainSaved = 1, playerLosses = 0, enemyLosses = 0;
  let stageIdx = 0;
  const STAGES = ['第一阶段 · 接敌', '第二阶段 · 抢渡', '第三阶段 · 脱离'];
  let ended = false;

  /* ── 地形查询 ── */
  const RIVER = { x: 0.34, w: 0.045 };         // 淝水竖向（归一化坐标）
  const CROSS = { y: 0.52, w: 0.06 };          // 浅滩位置
  let hill = { x: 0.55, y: 0.22 };
  let woods = [];

  function isRiver(nx, nz) { return Math.abs(nx - RIVER.x) < RIVER.w && !(Math.abs(nz - CROSS.y) < CROSS.w); }
  function isShallow(nx, nz) { return Math.abs(nx - RIVER.x) < RIVER.w && Math.abs(nz - CROSS.y) < CROSS.w; }
  function inWoods(nx, nz) { return woods.some(w => Math.hypot(nx - w.x, nz - w.y) < w.r); }
  function onHill(nx, nz) { return Math.hypot(nx - hill.x, nz - hill.y) < 0.09; }
  function groundY(nx, nz) {
    let y = 0;
    if (isRiver(nx, nz)) y = -0.55;
    else if (isShallow(nx, nz)) y = -0.28;
    else if (onHill(nx, nz)) y = 2.6 * Math.max(0, 1 - Math.hypot(nx - hill.x, nz - hill.y) / 0.09);
    return y;
  }

  /* ═══════════ 启动 ═══════════ */
  function start(opts) {
    cfg = D.battleDukou;
    onResult = opts.onResult;
    canvas = document.getElementById('bt-gl');
    labelHost = document.getElementById('bt-labels');
    labelHost.innerHTML = '';
    ended = false; elapsed = 0; paused = false; speed = 1;
    grainSaved = 1; playerLosses = 0; enemyLosses = 0; stageIdx = 0;
    alerts = [];

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xE9E1CB);
    scene.fog = new THREE.Fog(0xE9E1CB, 60, 190);
    scene.add(new THREE.HemisphereLight(0xFFF8E8, 0x8A7A5C, 1.05));
    const sun = new THREE.DirectionalLight(0xFFF2D8, 0.85); sun.position.set(30, 60, 20); scene.add(sun);

    buildTerrain();

    // 单位
    units = [];
    const S = SHL.State.current();
    cfg.playerUnits.forEach(u => {
      units.push(makeUnit(u, 'player', {
        moraleShift: S ? 0 : 0,
      }));
    });
    cfg.enemyUnits.forEach(u => units.push(makeUnit(u, 'enemy', {})));

    camera = new THREE.PerspectiveCamera(44, 2, 0.1, 500);
    camera.position.set(28, 34, 62);
    camera.lookAt(10, 0, 8);

    raycaster = new THREE.Raycaster();
    bindInput();
    resize();
    buildUnitBar();
    setAlert('敌前锋自西岸渡口以东集结，正寻我粮车。', 'threat');
    setAlert('建议：弩手据东岸林缘，可覆盖浅滩。', 'sugg');
    alive = true;
    running = true;
    loop();
    updateGoal();
  }

  /* ═══════════ 地形 ═══════════ */
  function buildTerrain() {
    // 地面
    const geo = new THREE.PlaneGeometry(120, 100, 60, 50);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cLow = new THREE.Color(0xD5CBAE), cGrass = new THREE.Color(0x9FA489), cSand = new THREE.Color(0xC9BC97);
    hill = cfg.terrain.hill;
    woods = [
      { x: cfg.terrain.woodsEast[0], y: cfg.terrain.woodsEast[1], r: 0.10 },
      { x: cfg.terrain.woodsWest[0], y: cfg.terrain.woodsWest[1], r: 0.08 },
    ];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const nx = x / 120 + 0.5, nz = z / 100 + 0.5;
      let y = 0;
      if (isRiver(nx, nz)) y = -0.6;
      else if (isShallow(nx, nz)) y = -0.3;
      if (onHill(nx, nz)) y = 2.8 * Math.max(0, 1 - Math.hypot(nx - hill.x, nz - hill.y) / 0.09);
      pos.setY(i, y);
      const c = isRiver(nx, nz) || isShallow(nx, nz) ? cSand.clone().lerp(new THREE.Color(0x54768A), 0.6)
        : cLow.clone().lerp(cGrass, (Math.sin(nx * 40) * Math.cos(nz * 30) + 1) / 2 * 0.5);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));
    // 水面
    const water = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 100), new THREE.MeshBasicMaterial({ color: 0x6F8A94, transparent: true, opacity: 0.75, depthWrite: false }));
    water.rotation.x = -Math.PI / 2;
    water.position.set((RIVER.x - 0.5) * 120, -0.35, 0);
    scene.add(water);
    // 浅滩标记（石梁）
    for (let i = 0; i < 5; i++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 2.2), new THREE.MeshLambertMaterial({ color: 0x9C8665 }));
      st.position.set((RIVER.x - 0.5) * 120 + (i % 2 ? 1.4 : -1.4), -0.25, (CROSS.y + (i - 2) * 0.02 - 0.5) * 100);
      scene.add(st);
    }
    // 树林
    const rnd = SHL.Map3D ? null : null;
    const tgeo = new THREE.ConeGeometry(1.1, 3.4, 5);
    const tmat = new THREE.MeshLambertMaterial({ color: 0x4A554A, flatShading: true });
    const inst = new THREE.InstancedMesh(tgeo, tmat, 130);
    const m4 = new THREE.Matrix4();
    let k = 0;
    const rr = mulberry32(cfg.seed);
    woods.forEach(w => {
      for (let i = 0; i < 65; i++) {
        const a = rr() * Math.PI * 2, d = Math.sqrt(rr()) * w.r * 120;
        const x = (w.x - 0.5) * 120 + Math.cos(a) * d, z = (w.y - 0.5) * 100 + Math.sin(a) * d * 0.83;
        if (isRiver(x / 120 + 0.5, z / 100 + 0.5)) continue;
        const s = 0.55 + rr() * 0.5;
        m4.makeScale(s, s, s);
        m4.setPosition(x, 2.2 * s, z);
        inst.setMatrixAt(k++, m4);
      }
    });
    inst.count = k;
    scene.add(inst);
    // 撤离区（西岸）
    const ez = cfg.exitZone;
    const exitPlane = new THREE.Mesh(new THREE.PlaneGeometry(9, 28), new THREE.MeshBasicMaterial({ color: 0x75816B, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    exitPlane.rotation.x = -Math.PI / 2;
    exitPlane.position.set((ez.x1 - 0.5) * 120 + 4.5, 0.06, ((ez.y1 + ez.y2) / 2 - 0.5) * 100);
    scene.add(exitPlane);
    const exitRing = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.18, 6, 24), new THREE.MeshBasicMaterial({ color: 0x4F5A4A }));
    exitRing.rotation.x = Math.PI / 2;
    exitRing.position.set(exitPlane.position.x, 0.12, exitPlane.position.z);
    exitRing.name = 'exitRing';
    scene.add(exitRing);
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ═══════════ 单位 ═══════════ */
  function makeUnit(u, side, opts) {
    const col = side === 'player' ? D.factions.jin.color : D.factions.qin.color;
    const g = new THREE.Group();
    const color = new THREE.Color(col);
    const isConvoy = !!u.isConvoy;
    const cnt = u.type === 'wagon' ? 5 : u.reserve ? 9 : 12;
    const mat = new THREE.MeshLambertMaterial({ color: color.getHex(), flatShading: true });
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
    if (isConvoy) {
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
    // 旗
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 5), new THREE.MeshLambertMaterial({ color: 0x3A403D }));
    pole.position.set(0, 3, -1.4);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5, 4, 2), new THREE.MeshBasicMaterial({ color: color.getHex(), side: THREE.DoubleSide, transparent: u.reserve, opacity: u.reserve ? 0.55 : 1 }));
    flag.position.set(1.2, 5.2, -1.4);
    g.add(pole); g.add(flag);
    // 选中环
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.14, 6, 26), new THREE.MeshBasicMaterial({ color: 0x984C3F, transparent: true, opacity: 0 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.15;
    g.add(ring);
    scene.add(g);

    const x = (u.start[0] - 0.5) * 120, z = (u.start[1] - 0.5) * 100;
    g.position.set(x, groundY(u.start[0], u.start[1]), z);

    const label = document.createElement('div');
    label.className = 'map-label legion';
    label.style.borderColor = col;
    label.style.color = col;
    label.textContent = u.name + ' ' + u.strength;
    labelHost.appendChild(label);

    return {
      ...u, side, group: g, flag, ring, label,
      hp: u.strength, maxHp: u.strength,
      morale: u.morale, fatigue: u.fatigue,
      order: u.reserve ? 'reserve' : (isConvoy ? 'advance' : 'hold'),
      orderState: '待命',
      dest: null, moving: false, routed: false, dead: false,
      speedBase: u.type === 'cavalry' ? 7.5 : u.type === 'wagon' ? 2.2 : u.type === 'archer' ? 4.6 : 5.4,
      range: u.type === 'archer' ? 16 : u.type === 'cavalry' ? 5.5 : 6.5,
      dps: u.type === 'archer' ? 9 : u.type === 'cavalry' ? 14 : 10,
      engaged: false, engagedWith: null,
    };
  }

  /* ═══════════ 输入 ═══════════ */
  function bindInput() {
    // 战场镜头：滚轮缩放 · 右键环绕
    const center = new THREE.Vector3(10, 0, 8);
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
      const r = canvas.getBoundingClientRect();
      const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
      const ny = -((e.clientY - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
      const hits = raycaster.intersectObjects(units.filter(u => u.side === 'player' && !u.dead).map(u => u.group), true);
      if (hits.length) {
        let o = hits[0].object;
        while (o.parent && !units.find(u => u.group === o)) o = o.parent;
        const u = units.find(x => x.group === o);
        if (u) { selectUnit(u.id); SHL.Audio.tick(); }
      }
    };
    window.addEventListener('keydown', onKey);
  }
  function onKey(e) {
    if (!running) return;
    if (e.code === 'Space') { e.preventDefault(); setSpeed(paused ? lastSpeed || 1 : 0); }
  }
  let lastSpeed = 1;

  /* ═══════════ UI ═══════════ */
  function buildUnitBar() {
    const bar = document.getElementById('bt-units');
    bar.innerHTML = '';
    units.filter(u => u.side === 'player').forEach(u => {
      const el = document.createElement('div');
      el.className = 'bt-unit' + (u.reserve ? ' reserve' : '');
      el.id = 'bu-' + u.id;
      el.innerHTML = `
        <h5><span>${u.name}</span><span class="u-strength">${u.hp}</span></h5>
        <div class="u-bars">
          <div class="u-bar m"><i style="width:${u.morale}%"></i></div>
          <div class="u-bar f"><i style="width:${u.fatigue}%"></i></div>
        </div>
        <div class="u-order">${orderLabel(u)}</div>`;
      el.addEventListener('click', () => { selectUnit(u.id); SHL.Audio.tick(); });
      bar.appendChild(el);
      u.el = el;
    });
    document.getElementById('btc-title').textContent = '军令 —— ' + cfg.commanderName + ' · 护粮都督';
    buildCmdBtns();
  }
  function orderLabel(u) {
    const map = { hold: '坚守', advance: '推进', escort: '护卫粮车', retreat: '撤退', reserve: '预备队', stuck: '受阻' };
    const s = u.orderState === '受阻' ? ' · 受阻' : (u.moving ? ' · 正在执行' : u.order !== 'reserve' ? ' · 已收到' : '');
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
      const res = units.find(u => u.reserve && u.side === 'player' && !u.dead && u.order === 'reserve');
      if (!res) { setAlert('预备队已全部投入，或已接战。', 'sugg'); return; }
      res.order = 'hold'; res.reserve = false;
      res.flag.material.opacity = 1;
      res.orderState = '已收到';
      setAlert('预备队·丁营已投入，正向东岸缺口展开。', 'sugg');
      refreshCmdBtns(); refreshUnitBar();
      return;
    }
    if (!selected) { setAlert('先在部队栏或战场中选择一支队伍。', 'sugg'); return; }
    const u = units.find(x => x.id === selected);
    if (!u || u.dead) return;
    if (u.order === 'reserve') { setAlert(u.name + ' 尚为预备队，需先「投入预备队」。', 'sugg'); return; }
    u.order = cmd === 'turn' ? u.order : cmd;
    u.orderState = '已收到';
    if (cmd === 'turn') {
      const th = nearestEnemy(u);
      if (th) { u.group.lookAt(th.group.position.x, u.group.position.y, th.group.position.z); u.orderState = '正在执行'; }
    }
    refreshCmdBtns(); refreshUnitBar();
  }
  function refreshCmdBtns() {
    document.querySelectorAll('#btc-btns .btn').forEach(b => {
      b.classList.toggle('selected', selected && b.dataset.cmd === (units.find(x => x.id === selected) || {}).order);
    });
  }
  function selectUnit(id) {
    selected = id;
    units.forEach(u => u.ring.material.opacity = (u.id === id && u.side === 'player') ? 0.9 : 0);
    refreshCmdBtns();
    refreshUnitBar();
  }
  function refreshUnitBar() {
    units.filter(u => u.side === 'player').forEach(u => {
      if (!u.el) return;
      u.el.querySelector('.u-strength').textContent = Math.round(u.hp);
      u.el.querySelector('.u-bar.m i').style.width = Math.max(0, u.morale) + '%';
      u.el.querySelector('.u-bar.f i').style.width = u.fatigue + '%';
      const o = u.el.querySelector('.u-order');
      o.textContent = orderLabel(u);
      o.className = 'u-order' + (u.orderState === '受阻' ? ' stuck' : u.moving ? ' exec' : '');
      u.el.classList.toggle('selected', selected === u.id);
      u.el.classList.toggle('dead', u.dead);
    });
  }
  function updateGoal() {
    document.getElementById('bt-goal-text').textContent = cfg.objective;
    document.getElementById('bt-goal-opt').textContent = cfg.objectiveOpt;
    document.getElementById('bt-stage').textContent = STAGES[Math.min(2, stageIdx)];
  }

  function setAlert(text, kind) {
    alerts.unshift({ text, kind });
    if (alerts.length > 2) alerts.pop();
    const box = document.getElementById('bt-intel-list');
    box.innerHTML = alerts.map(a => `<div class="bt-alert ${a.kind === 'sugg' ? 'sugg' : ''}">${a.text}</div>`).join('');
  }

  function setSpeed(v) {
    if (v === 0) { paused = true; }
    else { paused = false; speed = v; lastSpeed = v; }
    document.querySelectorAll('.bt-speed').forEach(b => {
      b.classList.toggle('active', Number(b.dataset.speed) === (paused ? 0 : speed));
    });
    document.querySelector('.bt-speed[data-speed="0"]').textContent = paused ? '继续 (空格)' : '暂停 (空格)';
  }

  /* ═══════════ 战斗模型（自动处理与亲自指挥共用） ═══════════ */
  function nearestEnemy(u) {
    let best = null, bd = 1e9;
    units.forEach(o => {
      if (o.side === u.side || o.dead || o.routed) return;
      const d = u.group.position.distanceTo(o.group.position);
      if (d < bd) { bd = d; best = o; }
    });
    return best;
  }
  function convoy() { return units.find(u => u.isConvoy); }

  function stepUnit(u, dt) {
    if (u.dead) { u.group.visible = false; u.label.style.display = 'none'; return; }
    if (u.routed) {
      // 溃退向东（敌方溃兵向西）
      const dir = u.side === 'player' ? -1 : 1;
      u.group.position.x += dir * 8 * dt;
      u.label.textContent = u.name + ' 溃退';
      u.label.style.opacity = 0.5;
      syncUnitTransform(u);
      return;
    }
    const nz = u.group.position.z / 100 + 0.5, nx = u.group.position.x / 120 + 0.5;
    let target = null, moveSpeed = u.speedBase * (1 - u.fatigue / 200);

    // 阵形/地形修正
    if (isRiver(nx, nz)) moveSpeed *= 0.35;
    if (isShallow(nx, nz)) moveSpeed *= 0.6;      // 浅滩可通行但减速
    if (inWoods(nx, nz)) moveSpeed *= 0.7;
    if (u.type === 'wagon') moveSpeed *= isShallow(nx, nz) ? 0.5 : 1;

    // 行为
    const cv = convoy();
    if (u.side === 'player') {
      if (u.isConvoy) {
        // 粮车先取浅滩东口，过河后直奔西岸撤离点
        const nx2 = u.group.position.x / 120 + 0.5;
        if (nx2 > RIVER.x + RIVER.w) target = { x: -12, z: (CROSS.y - 0.5) * 100 };
        else target = { x: (cfg.exitZone.x1 - 0.5) * 120 + 3, z: u.group.position.z };
      } else if (u.order === 'escort' && cv && !cv.dead) {
        const d = u.group.position.distanceTo(cv.group.position);
        target = d > 8 ? cv.group.position : null;
      } else if (u.order === 'advance') {
        const e = nearestEnemy(u);
        if (e && u.group.position.distanceTo(e.group.position) > u.range * 0.8) target = e.group.position;
        else if (cv && !cv.dead && u.group.position.distanceTo(cv.group.position) > 14) target = cv.group.position;
      } else if (u.order === 'retreat') {
        target = { x: 46, z: u.group.position.z };
        if (u.group.position.x > 44) { u.orderState = '已撤离'; u.hp = Math.max(u.hp, 0); u.safe = true; }
      }
    } else {
      // 敌方AI：优先攻击拦路的晋军，无拦截则直扑粮车
      let interceptor = null, id = 1e9;
      units.forEach(o => {
        if (o.side !== 'player' || o.dead || o.routed || o.isConvoy) return;
        const d = u.group.position.distanceTo(o.group.position);
        if (d < 22 && d < id) { id = d; interceptor = o; }
      });
      if (interceptor) {
        target = id > u.range * 0.8 ? interceptor.group.position : null;
      } else if (cv && !cv.dead) {
        const d = u.group.position.distanceTo(cv.group.position);
        target = d > u.range * 0.7 ? cv.group.position : null;
        if (u.type === 'cavalry' && d < 26 && d > 10) {
          // 迂回侧翼
          target = { x: cv.group.position.x + 6, z: cv.group.position.z + 10 };
        }
      } else {
        const e = units.find(x => x.side === 'player' && !x.dead && !x.routed);
        if (e) target = e.group.position;
      }
    }

    u.moving = !!target;
    if (target) {
      const dx = target.x - u.group.position.x, dz = target.z - u.group.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.2) {
        const st = moveSpeed * dt;
        const npos = u.group.position.clone();
        npos.x += dx / d * st; npos.z += dz / d * st;
        // 单位间隔防重叠
        units.forEach(o => {
          if (o === u || o.dead) return;
          const dd = npos.distanceTo(o.group.position);
          if (dd < 4.5 && dd > 0.01) {
            npos.x += (npos.x - o.group.position.x) / dd * (4.5 - dd) * 0.5;
            npos.z += (npos.z - o.group.position.z) / dd * (4.5 - dd) * 0.5;
          }
        });
        u.group.position.x = npos.x; u.group.position.z = npos.z;
        u.group.position.y = groundY(nx, nz);
        // 面向
        u.group.rotation.y = Math.atan2(dx, dz) * -1;
        u.orderState = '正在执行';
      } else u.orderState = '已到位';
    }

    // 交战
    let took = 0, gave = 0;
    units.forEach(o => {
      if (o.side === u.side || o.dead || o.routed) return;
      const d = u.group.position.distanceTo(o.group.position);
      if (d < u.range) {
        const moral = 1 + u.morale / 200;
        const fatigueF = 1 - u.fatigue / 250;
        const charge = u.type === 'cavalry' && u.moving ? 1.5 : 1;
        const dmg = u.dps * moral * fatigueF * charge * dt * 0.5;
        o.hp -= dmg; gave += dmg;
        u.engaged = true; u.engagedWith = o;
        o.engaged = true; o.engagedWith = u;
      }
    });
    // 士气
    if (gave > 0) u.morale = Math.min(100, u.morale + dt * 0.8);
    const hpFrac = u.hp / u.maxHp;
    if (hpFrac < 0.5) u.morale -= dt * 1.6;
    if (hpFrac < 0.25) u.morale -= dt * 3;
    if (u.fatigue > 70) u.morale -= dt * 0.6;
    // 阵形散乱：渡河中士气流失
    if (isRiver(nx, nz) || isShallow(nx, nz)) u.morale -= dt * 0.9;
    u.fatigue = Math.min(100, u.fatigue + dt * (u.moving ? 1.1 : 0.25));

    if (u.morale < 25) {
      u.routed = true;
      setAlert(`${u.name} 士气崩溃，正脱离战场！`, 'threat');
      SHL.Audio.alert();
    }
    if (u.hp <= 0) {
      u.dead = true;
      if (u.side === 'player') playerLosses += u.strength; else enemyLosses += u.strength;
      if (u.isConvoy) setAlert('粮车尽失！辎重已毁。', 'threat');
    }
    syncUnitTransform(u);
  }

  function syncUnitTransform(u) {
    const p = u.group.position;
    u.label.style.transform = `translate(-50%,-100%) translate(${((p.x / 120 + 0.5) * 100).toFixed(1)}%, 0)`;
    // 用世界坐标投影
    const v = p.clone(); v.y += 7; v.project(camera);
    const r = canvas.getBoundingClientRect();
    if (v.z > 1) { u.label.style.display = 'none'; return; }
    u.label.style.display = 'block';
    u.label.style.transform = `translate(-50%,-100%) translate(${(v.x * 0.5 + 0.5) * r.width}px,${(-v.y * 0.5 + 0.5) * r.height}px)`;
    u.label.textContent = u.name + ' ' + Math.max(0, Math.round(u.hp)) + (u.routed ? ' · 溃退' : '') + (u.dead ? ' · 殁' : '');
  }

  /* ═══════════ 局部规则军情 ═══════════ */
  let threatTimer = 0;
  function checkThreats(dt) {
    threatTimer -= dt;
    if (threatTimer > 0) return;
    threatTimer = 4;
    const cv = convoy();
    if (cv && !cv.dead) {
      const cav = units.find(u => u.side === 'enemy' && u.type === 'cavalry' && !u.dead && !u.routed);
      if (cav && cav.group.position.distanceTo(cv.group.position) < 20)
        setAlert('敌骑兵正迂回粮车！速令一队拦截。', 'threat');
      const nx = cv.group.position.x / 120 + 0.5, nz = cv.group.position.z / 100 + 0.5;
      if (isRiver(nx, nz)) {
        stageIdx = Math.max(stageIdx, 1);
        if (!cv.warned) { setAlert('运输队正在渡河——队列散乱，辎重易受袭。', 'threat'); cv.warned = true; }
      }
      if (cv.group.position.x < (cfg.exitZone.x1 - 0.5) * 120 + 8) stageIdx = 2;
    }
    // 建议类
    const arch = units.find(u => u.id === 'p3' && !u.dead);
    if (arch && isRiver(arch.group.position.x / 120 + 0.5, arch.group.position.z / 100 + 0.5))
      setAlert('建议：弩手渡河则失林缘之利，宜撤回东岸。', 'sugg');
  }

  /* ═══════════ 胜负 ═══════════ */
  function checkEnd() {
    if (ended) return;
    const cv = convoy();
    // 胜：粮车到达撤离区
    if (cv && !cv.dead && cv.hp > 0 && cv.group.position.x < (cfg.exitZone.x1 - 0.5) * 120 + 5) {
      finish(true, '运输队安然渡过淝水，粮道复通。');
      return;
    }
    // 负：粮车被毁 或 我方全灭/全溃
    const players = units.filter(u => u.side === 'player');
    const combat = players.filter(u => !u.isConvoy);
    if (!cv || cv.dead) { finish(false, '运输队毁于渡口，粮道中断。'); return; }
    if (combat.every(u => u.dead || u.routed || u.safe)) {
      if (cv && !cv.dead) finish(true, '掩护部队虽尽，粮车竟得全而退——虽胜犹惋。');
      else finish(false, '掩护尽没，粮车不保。');
      return;
    }
    // 时限：按委任自动结算
    if (elapsed > cfg.timeLimit) {
      finish(cv && !cv.dead && cv.hp > cv.maxHp * 0.4, '时限已至，按预案由都督自动结算（委任结果）。');
    }
  }

  function finish(win, text) {
    ended = true; running = false;
    // 统计：阵亡 + 溃散（溃散折半计损）
    const routedEnemy = units.filter(u => u.side === 'enemy' && u.routed).reduce((s, u) => s + Math.max(0, u.hp), 0);
    const routedPlayer = units.filter(u => u.side === 'player' && u.routed && !u.isConvoy).reduce((s, u) => s + Math.max(0, u.hp), 0);
    const cv = convoy();
    const convoyHp = cv ? Math.max(0, cv.hp / cv.maxHp) : 0;
    playerLosses += routedPlayer * 0.5;
    enemyLosses += routedEnemy;
    const wounded = Math.round(playerLosses * 0.3);
    const result = {
      win, text,
      losses: { player: Math.round(playerLosses), enemy: Math.round(enemyLosses) },
      convoyHp, wounded,
      time: Math.round(elapsed),
      assumptions: [],
    };
    lastResult = result;
    // 假设对比（军议AI解释）
    result.assumptions = [
      { k: '「敌约三千，无浮桥」', ok: enemyStrengthSeen() < 2400, note: enemyStrengthSeen() < 2400 ? '与侦报相符' : '实测敌锋较侦报更多，情报低估' },
      { k: '「浅滩可快速通过」', ok: !blockedAtCrossing(), note: blockedAtCrossing() ? '浅滩一度受阻，辎重减速明显' : '浅滩通过顺利' },
      { k: '「林缘可覆盖渡口」', ok: archerHoldEast(), note: archerHoldEast() ? '弩手保持东岸位，火力覆盖实现' : '弩手脱离掩护位，火力中断' },
    ];
    const box = document.getElementById('bt-result');
    document.getElementById('btr-body').innerHTML = `
      <p><b>${text}</b></p>
      <p>用时 ${fmt(result.time)} · 我方伤亡 <b class="num-neg">${result.losses.player}</b> · 敌方伤亡 <b class="num-pos">${result.losses.enemy}</b></p>
      <p>辎重保存 <b>${Math.round(convoyHp * 100)}%</b> · 伤员 ${wounded} 人</p>
      <p class="dim">本结果由战斗规则产生；AI 仅解释原方案假设的成立与否。</p>`;
    box.classList.remove('hidden');
    SHL.Audio.turn();
  }
  function enemyStrengthSeen() { return units.filter(u => u.side === 'enemy' && !u.dead).reduce((s, u) => s + u.hp, 0) + enemyLosses; }
  function blockedAtCrossing() { return grainSaved < 1 && false; }
  function archerHoldEast() {
    const a = units.find(u => u.id === 'p3');
    return a && !a.dead && (a.group.position.x / 120 + 0.5) > RIVER.x;
  }
  function fmt(s) { return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }

  /* ═══════════ 主循环 ═══════════ */
  function loop() {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    const rawDt = Math.min(0.05, clockDelta());
    const dt = paused ? 0 : rawDt * speed;
    if (!ended && dt > 0) {
      elapsed += dt;
      units.forEach(u => stepUnit(u, dt));
      checkThreats(dt);
      refreshUnitBar();
      checkEnd();
      document.getElementById('bt-timer').textContent = fmt(elapsed);
    }
    // 旗帜动画
    const t = performance.now() / 1000;
    units.forEach(u => {
      if (!u.dead) { u.flag.rotation.y = Math.sin(t * 2 + u.hp) * 0.2; u.flag.position.x = 1.2 + Math.sin(t * 2.4) * 0.1; }
    });
    // 镜头：右键拖拽旋转 + 滚轮
    renderer.render(scene, camera);
  }
  let _clock = performance.now();
  function clockDelta() {
    const now = performance.now();
    const d = (now - _clock) / 1000;
    _clock = now;
    return d;
  }

  /* ═══════════ 结束与回写 ═══════════ */
  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'btr-ok') {
      const box = document.getElementById('bt-result');
      box.classList.add('hidden');
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      const result = lastResult || { win: false, text: '交锋结束', losses: { player: 0, enemy: 0 }, convoyHp: 0, wounded: 0, time: 0 };
      lastResult = null;
      if (onResult) onResult(result);
    }
  });

  function resize() {
    if (!renderer) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  return {
    start, resize,
    setSpeed,
    get running() { return running; },
  };
})();
