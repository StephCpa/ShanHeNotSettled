/* ═══════════════════════════════════════════════════════════
   十六国 · 山河未定 — 3D 水墨地图（天下总览 / 战区沙盘 / 城池缩景）
   - 近景有坡度与地表结构；远景以墨色层次简化（方案§12）
   - 镜头：滚轮缩放 中键拖拽 Q/E旋转 Home复位；转场0.4—0.8秒
   - 放大分层显示：地名 → 城池军团细节 → 地形属性
   ═══════════════════════════════════════════════════════════ */
window.SHL = window.SHL || {};

SHL.Map3D = (function () {
  'use strict';
  const D = SHL.DATA;
  const PAPER = 0xF2ECDD;

  /* ── 确定性噪声（地形可复现） ── */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function makeValueNoise(seed) {
    const rnd = mulberry32(seed);
    const P = new Uint8Array(512);
    const perm = [...Array(256).keys()];
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
    const grads = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
    function g(ix, iy, x, y) {
      const gr = grads[P[(P[ix & 255] + iy) & 255] & 7];
      return gr[0] * (x - ix) + gr[1] * (y - iy);
    }
    function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    return function (x, y) {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = fade(x - ix), fy = fade(y - iy);
      const a = g(ix, iy, x, y), b = g(ix + 1, iy, x, y);
      const c = g(ix, iy + 1, x, y), d = g(ix + 1, iy + 1, x, y);
      const lerp = (t, u, v) => u + t * (v - u);
      return lerp(fy, lerp(fx, a, b), lerp(fx, c, d)) * 0.9;
    };
  }
  function fbm(noise, x, y, oct) {
    let v = 0, amp = 1, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { v += noise(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2.1; }
    return v / norm;
  }

  /* ── 颜色工具 ── */
  const C = (h) => new THREE.Color(h);
  const lerpC = (a, b, t) => a.clone().lerp(b, Math.max(0, Math.min(1, t)));

  /* ═══════════════ 模块状态 ═══════════════ */
  let renderer, camera, canvas;
  let worldScene = null, theaterScene = null, activeScene = null;
  let level = 'world';
  let pickables = [];
  const labels = [];           // {el, scene, pos:Vector3, kind, minD, maxD}
  const labelRoot = () => document.getElementById('map-labels');
  const camState = { az: -0.5, dist: 150, target: new THREE.Vector3(0, 0, 0), phi: 0.95 };
  const tween = { active: false, t: 0, dur: 0.6, from: null, to: null, onDone: null };
  let raycaster, mouseNDC;
  let hovered = null;
  let onPickCb = null, onLevelCb = null, onHoverCb = null;
  let settings = { reduceMotion: false, camFast: true, hiContrast: false };
  let layerActive = 'terrain';
  let waterAnims = [], banners = [], arrowsGroup = null, mistMesh = null, mistTarget = 0.62;
  let theaterHeight = null;
  let clock = new THREE.Clock();
  let rafId = 0;

  /* ═══════════════ 初始化 ═══════════════ */
  function init(opts) {
    canvas = opts.canvas;
    onPickCb = opts.onPick || null;
    onLevelCb = opts.onLevel || null;
    onHoverCb = opts.onHover || null;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000);
    raycaster = new THREE.Raycaster();
    mouseNDC = new THREE.Vector2();

    buildWorld();
    buildTheater();
    activeScene = worldScene;
    applyCamImmediate();

    bindInput();
    window.addEventListener('resize', resize);
    resize();
    loop();
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /* ═══════════════ 地形生成 ═══════════════ */
  function buildTerrain(scene, sizeX, sizeZ, segs, heightFn, palette) {
    const geo = new THREE.PlaneGeometry(sizeX, sizeZ, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cLow = C(palette.low), cMid = C(palette.mid), cHigh = C(palette.high), cPeak = C(palette.peak);
    const cGrass = C(palette.grass || palette.mid);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = heightFn(x, z);
      pos.setY(i, h);
      let c;
      if (h < 0.1) c = lerpC(C(0x8F8873), cLow, h / 0.1 + 1);
      else if (h < 9) {
        // 低地：纸赭与草木色斑驳（农田/草坡质感）
        const g = (Math.sin(x * 0.09) * Math.cos(z * 0.11) + 1) / 2;
        c = lerpC(cLow, cGrass, 0.2 + g * 0.55).lerp(cMid, h / 9 * 0.5);
      }
      else if (h < 18) c = lerpC(cMid, cHigh, (h - 9) / 9);
      else c = lerpC(cHigh, cPeak, Math.min(1, (h - 18) / 10));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    return mesh;
  }

  function riverRibbon(scene, pts, width, y, color, opacity) {
    // pts: [{x,z}...] 世界坐标折线 → 生成带状水面
    const shape = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len * width / 2, nz = dx / len * width / 2;
      shape.push([a.x + nx, a.z + nz], [a.x - nx, a.z - nz], [b.x + nx, b.z + nz]);
      shape.push([a.x - nx, a.z - nz], [b.x - nx, b.z - nz], [b.x + nx, b.z + nz]);
    }
    const geo = new THREE.BufferGeometry();
    const verts = new Float32Array(shape.length * 3);
    shape.forEach((s, i) => { verts[i * 3] = s[0]; verts[i * 3 + 1] = y; verts[i * 3 + 2] = s[1]; });
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity == null ? 0.8 : opacity, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    waterAnims.push({ mat, base: mat.opacity });
    return mesh;
  }

  function inkLine(scene, pts, y, color, dashed, opacity) {
    const v = pts.map(p => new THREE.Vector3(p.x, y, p.z));
    const geo = new THREE.BufferGeometry().setFromPoints(v);
    let mat;
    if (dashed) {
      mat = new THREE.LineDashedMaterial({ color, dashSize: 2.4, gapSize: 1.8, transparent: true, opacity: opacity == null ? 0.75 : opacity });
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      scene.add(line); return line;
    }
    mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: opacity == null ? 0.6 : opacity });
    const line = new THREE.Line(geo, mat);
    scene.add(line); return line;
  }

  /* ═══════════════ 场景一：天下总览 ═══════════════ */
  function buildWorld() {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(PAPER, 140, 380);
    scene.add(new THREE.HemisphereLight(0xFFF8E8, 0x9A8C6E, 1.15));
    const fill = new THREE.DirectionalLight(0xF2E8D0, 0.32);
    fill.position.set(-60, 45, -70);
    scene.add(fill);
    const sun = new THREE.DirectionalLight(0xFFF2D8, 0.85);
    sun.position.set(60, 100, 40);
    scene.add(sun);

    const noise = makeValueNoise(30416);
    // 华北—江淮 写意山水：北部草原缓起，太行秦岭成脊，江淮平原低平，江南丘陵
    function heightFn(x, z) {
      const u = x / 200, v = z / 140;
      let h = fbm(noise, u * 3 + 10, v * 3, 4) * 4.5 + 1.5;
      // 太行山脉（东北—西南）
      const taihang = Math.exp(-Math.pow((v * 140 - (0.30 * 140 - (u - 0.62) * 90)), 2) / 620) * 22 * smooth(u, 0.5, 0.82);
      // 秦岭（东西向，关中以南）
      const qinling = Math.exp(-Math.pow((v * 140 - 0.47 * 140), 2) / 240) * 26 * smooth(u, 0.12, 0.45);
      // 北部阴山草原
      const yinshan = Math.exp(-Math.pow((v * 140 - 0.06 * 140), 2) / 500) * 12;
      // 江南丘陵
      const south = Math.exp(-Math.pow((v * 140 - 0.92 * 140), 2) / 700) * 13 * smooth(u, 0.3, 0.9);
      h += taihang + qinling + yinshan + south;
      // 河谷压低：黄河(v~0.14) 淮水(v~0.60) 长江(v~0.80)
      const rivers = Math.exp(-Math.pow((v * 140 - 0.145 * 140), 2) / 90) * -3.5
        + Math.exp(-Math.pow((v * 140 - 0.60 * 140), 2) / 70) * -3.2
        + Math.exp(-Math.pow((v * 140 - 0.80 * 140), 2) / 80) * -3.4;
      h += rivers;
      return Math.max(-2.2, h);
    }
    function smooth(u, a, b) { const t = Math.max(0, Math.min(1, (u - a) / (b - a))); return t * t * (3 - 2 * t); }

    buildTerrain(scene, 200, 140, 150, heightFn,
      { low: 0xD9D0B6, mid: 0xA8AA8F, high: 0x6F7770, peak: 0x3F4441 });

    // 大河（写意三条）
    riverRibbon(scene, riverPts(200, 140, 0.145, 0.012, 0.02), 3.4, -0.7, 0x7E97A0, 0.75);   // 黄河
    riverRibbon(scene, riverPts(200, 140, 0.60, 0.014, -0.03), 3.0, -0.7, 0x7E97A0, 0.75);   // 淮水
    riverRibbon(scene, riverPts(200, 140, 0.80, 0.016, 0.02), 4.2, -0.7, 0x7E97A0, 0.75);    // 长江
    scene.add(mountainsBackdrop());

    // 势力色块与地域标签（可点击）
    Object.values(D.regions).forEach(r => {
      const patch = regionPatch(scene, r);
      const lbl = addLabel(scene, 'region-name', new THREE.Vector3(r.x * 200 - 100, 6, r.y * 140 - 70), r.short,
        { minD: 0, maxD: 1000, pick: { type: 'region', id: r.id } });
      patch.userData.pick = { type: 'region', id: r.id };
      pickables.push(patch);
    });

    worldScene = scene;
  }

  function riverPts(w, h, vCenter, amp, drift) {
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const u = i / 14;
      pts.push({ x: (u - 0.5) * w * 1.04, z: (vCenter - 0.5) * h + Math.sin(u * 9 + vCenter * 20) * amp * h + drift * h * u });
    }
    return pts;
  }

  function mountainsBackdrop() {
    // 远景墨色山影（低细节，符合§12远景以墨色层次简化）
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x54595B, transparent: true, opacity: 0.16, depthWrite: false });
    const mat2 = new THREE.MeshBasicMaterial({ color: 0x54595B, transparent: true, opacity: 0.09, depthWrite: false });
    const rnd = mulberry32(77);
    for (let i = 0; i < 16; i++) {
      const w = 26 + rnd() * 40, h = 16 + rnd() * 26;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(w * 0.5, h, 5), i % 2 ? mat : mat2);
      cone.position.set(-140 + i * 19 + rnd() * 8, h * 0.28, -110 + rnd() * 30);
      cone.rotation.y = rnd() * 3;
      g.add(cone);
    }
    return g;
  }

  function regionPatch(scene, r) {
    // 写意势力范围：不规则色斑
    const rnd = mulberry32(r.id.length * 1337 + r.x * 999);
    const pts = [];
    const R = 17;
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      const rr = R * (0.72 + rnd() * 0.5);
      pts.push(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
    }
    const geo = new THREE.ShapeGeometry(new THREE.Shape(pts));
    geo.rotateX(-Math.PI / 2);
    const fac = D.factions[r.owner] || null;
    const col = fac ? new THREE.Color(fac.color) : C(0xB9B3A2);
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: fac ? 0.30 : 0.14, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(r.x * 200 - 100, 2.6, r.y * 140 - 70);
    scene.add(mesh);
    // 边界样式：different dash patterns per faction
    const edge = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p.x, 2.7, p.y))),
      new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.85 })
    );
    edge.position.copy(mesh.position);
    scene.add(edge);
    return mesh;
  }

  /* ═══════════════ 场景二：淮南战区 ═══════════════ */
  const NODE2W = (n) => ({ x: (n.x / 800 - 0.5) * 380, z: (n.y / 700 - 0.5) * 330 });
  let theaterNodeMeshes = {};

  function buildTheater() {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(PAPER, 130, 340);
    scene.add(new THREE.HemisphereLight(0xFFF8E8, 0x9A8C6E, 1.15));
    const fill = new THREE.DirectionalLight(0xF2E8D0, 0.32);
    fill.position.set(-60, 45, -70);
    scene.add(fill);
    const sun = new THREE.DirectionalLight(0xFFF2D8, 0.8);
    sun.position.set(40, 90, 30);
    scene.add(sun);

    const noise = makeValueNoise(38310);
    const T = D.theaterHuainan;
    const W = {}; Object.values(T.nodes).forEach(n => W[n.id] = NODE2W(n));

    // 渡口/淝水参数：渡口在世界坐标
    const dk = W.dukou;
    function heightFn(x, z) {
      let h = fbm(noise, x * 0.03 + 5, z * 0.03, 4) * 2.8 + 1.3;
      // 八公山丘陵
      const bg = W.bagong;
      h += Math.exp(-(Math.pow(x - bg.x, 2) + Math.pow(z - bg.z, 2)) / 1000) * 20;
      // 东北低丘
      h += Math.exp(-(Math.pow(x - 150, 2) + Math.pow(z + 120, 2)) / 2600) * 9;
      // 西北与西南远山（墨色层次）
      h += Math.exp(-(Math.pow(x + 165, 2) + Math.pow(z + 110, 2)) / 2400) * 17;
      h += Math.exp(-(Math.pow(x + 110, 2) + Math.pow(z - 140, 2)) / 2800) * 13;
      h += Math.exp(-(Math.pow(x - 160, 2) + Math.pow(z + 60, 2)) / 1800) * 9;
      // 淮水（北缘压低）
      h += Math.exp(-Math.pow(z + 155, 2) / 500) * -5;
      // 淝水河道（自北向西南过渡口）
      const dRiver = distToRiver(x, z);
      h += Math.exp(-Math.pow(dRiver, 2) / 300) * -5.5;
      // 苇泽低地
      const rd = W.reed;
      h += Math.exp(-(Math.pow(x - rd.x, 2) + Math.pow(z - rd.z, 2)) / 2200) * -2.4;
      return h;
    }
    function distToRiver(x, z) {
      // 淝水折线：北端 → 渡口 → 苇泽西侧南下
      const p1 = { x: dk.x - 30, z: -165 }, p2 = dk, p3 = { x: dk.x - 45, z: 170 };
      return Math.min(segDist(x, z, p1, p2), segDist(x, z, p2, p3));
    }
    function segDist(px, pz, a, b) {
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(px - (a.x + t * dx), pz - (a.z + t * dz));
    }

    buildTerrain(scene, 380, 330, 150, heightFn,
      { low: 0xCFC5A6, mid: 0x9FA487, high: 0x6F7770, peak: 0x3F4441, grass: 0x9AA383 });
    theaterHeight = heightFn;

    // 水面
    const feiPts = riverThrough(dk);
    riverRibbon(scene, feiPts, 14, -1.0, 0x47707F, 0.95);
    riverRibbon(scene, [{ x: -60, z: -154.5 }, { x: 190, z: -152 }], 14, -2.4, 0x47707F, 0.95); // 淮水（东段）
    // 苇泽水洼
    const rd = W.reed;
    [[0, 0], [14, 8], [-12, 10]].forEach((o, i) => {
      const geo = new THREE.CircleGeometry(7 + i * 2.5, 14);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x6F8A94, transparent: true, opacity: 0.55, depthWrite: false }));
      m.position.set(rd.x + o[0], 0.18, rd.z + o[1]);
      scene.add(m);
    });

    // 道路
    T.roads.forEach(([a, b]) => {
      const A = W[a], B = W[b];
      const mid = { x: (A.x + B.x) / 2 + (A.z * B.x % 7) * 0.4, z: (A.z + B.z) / 2 + (A.x * B.z % 5) * 0.3 };
      inkLine(scene, [A, mid, B], 0.8, 0x4A4F4A, true, 0.8);
    });

    // 势力分界：沿淝水 dashed 朱线（晋东/秦西）
    inkLine(scene, feiPts, 0.9, 0x984C3F, true, 0.8);

    // 节点物件
    theaterNodeMeshes = {};
    Object.values(T.nodes).forEach(n => {
      const w = W[n.id];
      let g = null;
      if (n.type === 'city') g = buildCityCluster(scene, w, 0.6);
      else if (n.type === 'crossing') g = buildCrossing(scene, w);
      else if (n.type === 'camp') g = buildCamp(scene, w, D.factions.jin.color);
      else if (n.type === 'granary') g = buildGranary(scene, w);
      else if (n.type === 'hill') g = buildHillMark(scene, w);
      else if (n.type === 'marsh') g = buildReeds(scene, w);
      else if (n.type === 'road') g = buildWaystation(scene, w);
      else if (n.type === 'river') g = buildRuins(scene, w);
      if (g) {
        g.position.y = Math.max(0.3, heightFn(w.x, w.z)) + 0.25;
        g.userData.pick = { type: 'node', id: n.id };
        g.traverse(o => { if (o.isMesh) o.userData.pick = { type: 'node', id: n.id }; });
        pickables.push(g);
        theaterNodeMeshes[n.id] = g;
      }
      const isCity = n.type === 'city';
      addLabel(scene, isCity ? 'city' : 'node', new THREE.Vector3(w.x, 8, w.z), n.name, {
        minD: 0, maxD: 1000, pick: { type: 'node', id: n.id }, sub: n.desc,
      });
    });

    // 树木与农田（实例化）
    scatterTrees(scene, heightFn, W);
    scatterFarms(scene, W);

    // 西岸传闻标签
    addLabel(scene, 'node', new THREE.Vector3(dk.x - 90, 9, -40), '尚未侦察 · 传闻：西岸有炊烟数十处', { minD: 0, maxD: 260 });

    // 战争迷雾（西岸未侦察区：纸雾柔边，山影可透出地理轮廓，不展示隐蔽军队）
    const mistTex = makeMistTexture();
    mistMesh = new THREE.Mesh(new THREE.PlaneGeometry(165, 360), new THREE.MeshBasicMaterial({
      color: PAPER, transparent: true, opacity: 0.8, depthWrite: false, map: mistTex,
    }));
    mistMesh.geometry.rotateX(-Math.PI / 2);
    mistMesh.position.set(dk.x - 96, 4.2, 0);
    scene.add(mistMesh);
    mistTarget = 0.8;
    const mistEdge = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(dk.x - 170, 3.3, -168), new THREE.Vector3(dk.x - 20, 3.3, -168),
        new THREE.Vector3(dk.x - 20, 3.3, 168), new THREE.Vector3(dk.x - 170, 3.3, 168),
      ]),
      new THREE.LineDashedMaterial({ color: 0x9C8665, dashSize: 4, gapSize: 3, transparent: true, opacity: 0.9 })
    );
    mistEdge.computeLineDistances();
    scene.add(mistEdge);

    // 军团容器
    arrowsGroup = new THREE.Group();
    scene.add(arrowsGroup);

    theaterScene = scene;
  }

  function makeMistTexture() {
    // 柔边纸雾：中心不透明，边缘渐散
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, 30, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.96)');
    g.addColorStop(0.82, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    // 叠加少量云纹
    const rnd = mulberry32(99);
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 26; i++) {
      const x = rnd() * 256, y = rnd() * 256, r = 18 + rnd() * 42;
      const gg = ctx.createRadialGradient(x, y, 2, x, y, r);
      gg.addColorStop(0, 'rgba(255,255,255,0.8)');
      gg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gg;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const tex = new THREE.CanvasTexture(cv);
    return tex;
  }

  function riverThrough(dk) {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const z = -165 + t * 335;
      const x = t < 0.5
        ? (dk.x - 30) + (dk.x - (dk.x - 30)) * (t / 0.5)
        : (dk.x) + ((dk.x - 45) - dk.x) * ((t - 0.5) / 0.5);
      pts.push({ x, z });
    }
    return pts;
  }

  /* ── 节点物件 ── */
  const MAT = {
    wall: new THREE.MeshLambertMaterial({ color: 0xB3A482, flatShading: true }),
    roof: new THREE.MeshLambertMaterial({ color: 0x5A605B, flatShading: true }),
    wood: new THREE.MeshLambertMaterial({ color: 0x7A6448, flatShading: true }),
    tent: new THREE.MeshLambertMaterial({ color: 0xC9BFA6, flatShading: true }),
    dark: new THREE.MeshLambertMaterial({ color: 0x3A403D, flatShading: true }),
  };

  function buildCityCluster(scene, w, scale) {
    const g = new THREE.Group();
    const s = scale;
    // 夯土城墙
    const wallSeg = (len, x, z, rot) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 4.2 * s, 1.6 * s), MAT.wall);
      m.position.set(x, 2.1 * s, z); m.rotation.y = rot;
      g.add(m);
    };
    wallSeg(26 * s, 0, 9 * s, 0); wallSeg(26 * s, 0, -9 * s, 0);
    wallSeg(18 * s, 13 * s, 0, Math.PI / 2); wallSeg(18 * s, -13 * s, 0, Math.PI / 2);
    // 城门楼
    const gate = new THREE.Mesh(new THREE.BoxGeometry(4.4 * s, 6.5 * s, 4.4 * s), MAT.dark);
    gate.position.set(0, 3.2 * s, 9.4 * s); g.add(gate);
    const gateRoof = new THREE.Mesh(new THREE.ConeGeometry(4 * s, 2.2 * s, 4), MAT.roof);
    gateRoof.position.set(0, 7.4 * s, 9.4 * s); gateRoof.rotation.y = Math.PI / 4; g.add(gateRoof);
    // 角楼
    [[13, 9], [-13, 9], [13, -9], [-13, -9]].forEach(p => {
      const t = new THREE.Mesh(new THREE.BoxGeometry(2.4 * s, 5 * s, 2.4 * s), MAT.wall);
      t.position.set(p[0] * s, 2.5 * s, p[1] * s); g.add(t);
      const r = new THREE.Mesh(new THREE.ConeGeometry(2.2 * s, 1.6 * s, 4), MAT.roof);
      r.position.set(p[0] * s, 5.8 * s, p[1] * s); r.rotation.y = Math.PI / 4; g.add(r);
    });
    // 屋舍
    const rnd = mulberry32(9);
    for (let i = 0; i < 14; i++) {
      const bx = (rnd() - 0.5) * 20 * s, bz = (rnd() - 0.5) * 12 * s;
      const bw = 2 + rnd() * 2.4, bh = 1.6 + rnd() * 1.6;
      const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bw * 0.8), MAT.wall);
      b.position.set(bx, bh / 2 * s + 0.4, bz); g.add(b);
      const r = new THREE.Mesh(new THREE.ConeGeometry(bw * 0.82, 1.2 * s, 4), MAT.roof);
      r.position.set(bx, bh + 0.6 * s + 0.4, bz); r.rotation.y = Math.PI / 4; g.add(r);
    }
    g.position.set(w.x, 0.6, w.z);
    scene.add(g);
    return g;
  }

  function buildCrossing(scene, w) {
    const g = new THREE.Group();
    // 码头栈桥（伸向河心）
    const dock = new THREE.Mesh(new THREE.BoxGeometry(14, 0.8, 3.4), MAT.wood);
    dock.position.set(0, 0.5, 0); g.add(dock);
    [[-5, -1], [5, -1], [-5, 1], [5, 1]].forEach(p => {
      const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.4, 6), MAT.wood);
      pile.position.set(p[0], -0.4, p[1]); g.add(pile);
    });
    // 渡船两艘
    [[8, 6], [-6, 8]].forEach((p, i) => {
      const boat = new THREE.Mesh(new THREE.BoxGeometry(5, 1, 2.2), MAT.wood);
      boat.position.set(p[0], -0.6, p[1]);
      boat.rotation.y = 0.4 * (i ? -1 : 1);
      g.add(boat);
    });
    // 界碑
    const stele = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 0.6), MAT.dark);
    stele.position.set(-4, 1.5, -3); g.add(stele);
    g.position.set(w.x, 0.2, w.z);
    scene.add(g);
    return g;
  }

  function buildCamp(scene, w, facColor) {
    const g = new THREE.Group();
    const rnd = mulberry32(42);
    for (let i = 0; i < 9; i++) {
      const tx = (rnd() - 0.5) * 26, tz = (rnd() - 0.5) * 18;
      const tent = new THREE.Mesh(new THREE.ConeGeometry(2.4, 3.2, 6), MAT.tent);
      tent.position.set(tx, 1.6, tz);
      g.add(tent);
    }
    // 中军帐
    const main = new THREE.Mesh(new THREE.ConeGeometry(4, 4.6, 8), MAT.tent);
    main.position.set(0, 2.3, 0); g.add(main);
    // 大纛
    addBanner(g, 0, 9, 0, facColor, 2.2);
    // 栅栏
    for (let i = 0; i < 22; i++) {
      const a = i / 22 * Math.PI * 2;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2, 5), MAT.wood);
      p.position.set(Math.cos(a) * 17, 1, Math.sin(a) * 12);
      g.add(p);
    }
    g.position.set(w.x, 0.4, w.z);
    scene.add(g);
    return g;
  }

  function buildGranary(scene, w) {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const silo = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.4, 4.4, 10), MAT.wall);
      silo.position.set((i - 1) * 8, 2.2, (i % 2) * 6 - 3);
      g.add(silo);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(3.6, 2.2, 10), MAT.roof);
      cone.position.set((i - 1) * 8, 5.5, (i % 2) * 6 - 3);
      g.add(cone);
    }
    const sack = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 1.2), MAT.tent);
    sack.position.set(6, 0.6, 4); g.add(sack);
    g.position.set(w.x, 0.5, w.z);
    scene.add(g);
    return g;
  }

  function buildHillMark(scene, w) {
    const g = new THREE.Group();
    const pav = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 0.6, 8), MAT.wall);
    pav.position.set(0, 0.3, 0); g.add(pav);
    [[0, 2.6], [2.6, 0], [-2.6, 0], [0, -2.6]].forEach(p => {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 4, 5), MAT.wood);
      c.position.set(p[0], 2, p[1]); g.add(c);
    });
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 1.8, 8), MAT.roof);
    roof.position.set(0, 4.6, 0); g.add(roof);
    g.position.set(w.x, 0, w.z);
    scene.add(g);
    return g;
  }

  function buildReeds(scene, w) {
    const g = new THREE.Group();
    const rnd = mulberry32(813);
    const geo = new THREE.CylinderGeometry(0.06, 0.09, 2.6, 4);
    const mat = new THREE.MeshLambertMaterial({ color: 0x8A8F6E, flatShading: true });
    const inst = new THREE.InstancedMesh(geo, mat, 160);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 160; i++) {
      m4.makeRotationZ((rnd() - 0.5) * 0.4);
      m4.setPosition((rnd() - 0.5) * 34, 1.1, (rnd() - 0.5) * 22);
      inst.setMatrixAt(i, m4);
    }
    g.add(inst);
    g.position.set(w.x, 0.2, w.z);
    scene.add(g);
    return g;
  }

  function buildWaystation(scene, w) {
    const g = new THREE.Group();
    const shed = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.2, 3), MAT.wood);
    shed.position.set(0, 1.1, 0); g.add(shed);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.4, 1.4, 4), MAT.roof);
    roof.position.set(0, 2.9, 0); roof.rotation.y = Math.PI / 4; g.add(roof);
    g.position.set(w.x, 0.4, w.z);
    scene.add(g);
    return g;
  }

  function buildRuins(scene, w) {
    const g = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 1.6, 1), MAT.wall);
    wall.position.set(0, 0.8, 0); g.add(wall);
    const rubble = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 2), MAT.wall);
    rubble.position.set(3, 0.4, 1); g.add(rubble);
    g.position.set(w.x, 0.3, w.z);
    scene.add(g);
    return g;
  }

  function addBanner(parent, x, y, z, color, h) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, h, 5), MAT.dark);
    pole.position.set(x, y + h / 2, z);
    const flagGeo = new THREE.PlaneGeometry(2.6, 1.7, 4, 2);
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    const flag = new THREE.Mesh(flagGeo, mat);
    flag.position.set(x + 1.3, y + h - 0.95, z);
    parent.add(pole); parent.add(flag);
    banners.push({ flag, phase: Math.random() * 6 });
    return flag;
  }

  function scatterTrees(scene, heightFn, W) {
    const rnd = mulberry32(777);
    const geo = new THREE.ConeGeometry(1.5, 4.2, 5);
    const mat = new THREE.MeshLambertMaterial({ color: 0x5C6B55, flatShading: true });
    const inst = new THREE.InstancedMesh(geo, mat, 700);
    const m4 = new THREE.Matrix4();
    let n = 0;
    const exclude = [{ x: W.dukou.x, z: W.dukou.z, r: 24 }, { x: W.camp.x, z: W.camp.z, r: 26 }, { x: W.shouyang.x, z: W.shouyang.z, r: 26 }];
    // 林缘聚集区（疏林）
    const groves = [
      { x: W.bagong.x + 20, z: W.bagong.z + 12, r: 42 },
      { x: W.camp.x + 46, z: W.camp.z - 24, r: 36 },
      { x: -60, z: 90, r: 40 },
    ];
    const inGrove = (x, z) => groves.some(gv => Math.hypot(x - gv.x, z - gv.z) < gv.r);
    for (let i = 0; i < 2400 && n < 700; i++) {
      const x = (rnd() - 0.5) * 370, z = (rnd() - 0.5) * 320;
      if (z < -140) continue;
      // 河道回避
      let nearRiver = false;
      const dk = W.dukou;
      for (let t = 0; t <= 1; t += 0.05) {
        const rz = -165 + t * 335;
        const rx = t < 0.5 ? (dk.x - 30) + 30 * (t / 0.5) : dk.x - 45 * ((t - 0.5) / 0.5);
        if (Math.hypot(x - rx, z - rz) < 13) { nearRiver = true; break; }
      }
      if (nearRiver) continue;
      if (exclude.some(e => Math.hypot(x - e.x, z - e.z) < e.r)) continue;
      const density = fbm(mkNoiseShared, x * 0.012 + 40, z * 0.012, 2);
      const grove = inGrove(x, z);
      if (density < (grove ? -0.05 : 0.1)) continue;
      const y = heightFn(x, z);
      if (y > 14 || y < 0.2) continue;
      const s = 0.45 + rnd() * 0.55;
      m4.makeScale(s, s * (0.8 + rnd() * 0.5), s);
      m4.setPosition(x, y + 2 * s, z);
      inst.setMatrixAt(n++, m4);
    }
    inst.count = n;
    scene.add(inst);
  }
  const mkNoiseShared = makeValueNoise(555);

  function scatterFarms(scene, W) {
    const rnd = mulberry32(31);
    const mat = new THREE.MeshLambertMaterial({ color: 0xAFA075, flatShading: true });
    const mat2 = new THREE.MeshLambertMaterial({ color: 0xC2B183, flatShading: true });
    const zones = [
      { cx: W.camp.x + 30, cz: W.camp.z + 55, n: 10 },
      { cx: W.shouyang.x + 40, cz: W.shouyang.z - 20, n: 8 },
      { cx: W.liangdao.x - 10, cz: W.liangdao.z + 25, n: 9 },
    ];
    zones.forEach(zo => {
      for (let i = 0; i < zo.n; i++) {
        const fw = 8 + rnd() * 12, fh = 5 + rnd() * 8;
        const f = new THREE.Mesh(new THREE.BoxGeometry(fw, 0.5, fh), rnd() > 0.5 ? mat : mat2);
        f.position.set(zo.cx + (rnd() - 0.5) * 60, 0.35, zo.cz + (rnd() - 0.5) * 44);
        f.rotation.y = (rnd() - 0.5) * 0.6;
        scene.add(f);
      }
    });
  }

  /* ═══════════════ 军团棋子 ═══════════════ */
  const legionObjects = {};
  function refreshLegions() {
    if (!theaterScene) return;
    const S = SHL.State.current();
    if (!S) return;
    const T = D.theaterHuainan;
    Object.values(S.legions).forEach(L => {
      let obj = legionObjects[L.id];
      if (!obj) {
        obj = new THREE.Group();
        const fac = D.factions[L.faction];
        const col = new THREE.Color(fac ? fac.color : 0x888888);
        // 旗
        addBanner(obj, 0, 0, 0, col.getHex(), L.scout ? 4.5 : 6);
        // 士卒（聚合小块，不逐兵）
        const cnt = L.scout ? 6 : L.transport ? 10 : 16;
        const geo = new THREE.ConeGeometry(0.5, 1.6, 5);
        const mat = new THREE.MeshLambertMaterial({ color: col.getHex(), flatShading: true, transparent: L.intel, opacity: L.intel ? 0.45 : 1, wireframe: L.intel });
        const inst = new THREE.InstancedMesh(geo, mat, cnt);
        const m4 = new THREE.Matrix4();
        const rnd = mulberry32(L.id.length * 91 + 7);
        for (let i = 0; i < cnt; i++) {
          const a = i / cnt * Math.PI * 2, r = 1.8 + rnd() * 2.4;
          m4.makeRotationY(rnd() * 3);
          m4.setPosition(Math.cos(a) * r, 0.8, Math.sin(a) * r);
          inst.setMatrixAt(i, m4);
        }
        obj.add(inst);
        if (L.transport) {
          const cart = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 1.6), MAT.wood);
          cart.position.set(0, 0.6, 3.4); obj.add(cart);
        }
        theaterScene.add(obj);
        legionObjects[L.id] = obj;
      }
      // 位置
      const nid = L.node;
      const n = T.nodes[nid];
      if (n) {
        const w = NODE2W(n);
        const off = L.id === 'qinvanguard' ? [-26, 10] : [5, 3];
        const gx = w.x + off[0], gz = w.z + off[1];
        const gy = theaterHeight ? theaterHeight(gx, gz) : 0.8;
        obj.position.set(gx, Math.max(0.4, gy) + 0.6, gz);
        const intelState = S.intel.dukou ? S.intel.dukou.state : 'unverified';
        if (L.intel) {
          obj.visible = intelState === 'confirmed'; // 核实后才显示敌军棋子（且以估计标记）
        } else obj.visible = true;
      }
      // 标签
      let lbl = labels.find(x => x.legionId === L.id);
      if (!lbl && n) {
        lbl = addLabel(theaterScene, 'legion', new THREE.Vector3(), L.name, { minD: 0, maxD: 999, legionId: L.id });
      }
      if (lbl) {
        lbl.pos.set(obj.position.x, 7.5, obj.position.z);
        const fac = D.factions[L.faction];
        lbl.el.style.borderColor = fac ? fac.color : '#888';
        lbl.el.style.color = L.intel ? 'var(--tu)' : (fac ? fac.color : '#888');
        lbl.el.textContent = L.name + (L.intel ? ' · 估计' : '');
        lbl.el.classList.toggle('dimmed', L.intel && mistOpacity() > 0.5);
      }
    });
  }
  function mistOpacity() { return mistMesh ? mistMesh.material.opacity : 0.62; }

  /* ═══════════════ 标签 ═══════════════ */
  function addLabel(scene, kind, pos, text, opts) {
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'map-label ' + kind;
    if (kind === 'city') el.innerHTML = `<span class="pin">▾</span>${text}` + (opts.sub ? `<span class="sub">${opts.sub}</span>` : '');
    else el.textContent = text;
    if (opts.pick) {
      el.addEventListener('click', (e) => { e.stopPropagation(); if (onPickCb) onPickCb(opts.pick); });
    }
    labelRoot().appendChild(el);
    if (opts.legionId) el.dataset.legionId = opts.legionId;
    const rec = { el, scene, pos: pos.clone(), kind, minD: opts.minD || 0, maxD: opts.maxD || 999, pick: opts.pick, legionId: opts.legionId };
    labels.push(rec);
    return rec;
  }
  function updateLabels() {
    const w = window.innerWidth, h = window.innerHeight;
    const camDist = camera.position.distanceTo(camState.target);
    labels.forEach(l => {
      const show = l.scene === activeScene && camDist >= l.minD && camDist <= l.maxD;
      if (!show) { l.el.style.display = 'none'; return; }
      const v = l.pos.clone().project(camera);
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) { l.el.style.display = 'none'; return; }
      l.el.style.display = 'block';
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      l.el.style.transform = `translate(-50%,-100%) translate(${x}px,${y}px)`;
      const d = camera.position.distanceTo(l.pos);
      const sc = Math.max(0.55, Math.min(1.25, 90 / Math.max(20, d)));
      if (l.kind !== 'region-name') l.el.style.fontSize = '';
      l.el.style.opacity = d > 200 ? 0.5 : 1;
    });
  }

  /* ═══════════════ 镜头控制 ═══════════════ */
  function bindInput() {
    let dragging = false, dragBtn = -1, lastX = 0, lastY = 0, movedDist = 0;
    canvas.addEventListener('mousedown', (e) => {
      dragging = true; dragBtn = e.button; lastX = e.clientX; lastY = e.clientY; movedDist = 0;
      if (e.button === 1 || e.button === 2) e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        movedDist += Math.abs(dx) + Math.abs(dy);
        lastX = e.clientX; lastY = e.clientY;
        if (dragBtn === 1 || dragBtn === 2 || dragBtn === 0) {
          if (dragBtn === 0 && movedDist > 6) canvas.classList.add('panning');
          // 平移：沿相机右向/前向在地面上移动 target
          const dir = new THREE.Vector3().subVectors(camState.target, camera.position).setY(0).normalize();
          const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).negate();
          const spd = camState.dist * 0.0016;
          camState.target.addScaledVector(right, dx * spd);
          camState.target.addScaledVector(dir, -dy * spd * 1.2);
          clampTarget();
          if (!tween.active) applyCamImmediate();
        }
      } else {
        // hover
        updateNDC(e);
        raycastHover();
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (dragging && dragBtn === 0 && movedDist < 6) {
        updateNDC(e);
        doPick();
      }
      dragging = false; canvas.classList.remove('panning');
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dir = Math.sign(e.deltaY);
      zoomBy(dir * 0.12);
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (level === 'battle') return;
      if (e.key === 'q' || e.key === 'Q') { camState.az += 0.12; if (!tween.active) applyCamImmediate(); }
      if (e.key === 'e' || e.key === 'E') { camState.az -= 0.12; if (!tween.active) applyCamImmediate(); }
      if (e.key === 'Home') { resetNorth(); }
      if (e.key === 'Escape') { if (onLevelCb) onLevelCb('esc'); }
    });
  }
  function clampTarget() {
    const lim = level === 'world' ? 110 : 185;
    camState.target.x = Math.max(-lim, Math.min(lim, camState.target.x));
    camState.target.z = Math.max(-lim * 0.85, Math.min(lim * 0.85, camState.target.z));
  }
  function zoomBy(frac) {
    const s = activeScene;
    const range = level === 'world' ? [70, 300] : [40, 280];
    camState.dist = Math.max(range[0], Math.min(range[1], camState.dist * (1 + frac)));
    if (!tween.active) applyCamImmediate();
  }
  function resetNorth() {
    camState.az = level === 'world' ? -0.5 : -0.5;
    tweenTo(camState.target.clone().setY(0), camState.dist, camState.az, 0.5);
  }

  function applyCamImmediate() {
    const t = camState;
    const px = t.target.x + Math.sin(t.az) * t.dist * Math.cos(t.phi);
    const pz = t.target.z + Math.cos(t.az) * t.dist * Math.cos(t.phi);
    const py = t.target.y + t.dist * Math.sin(t.phi);
    camera.position.set(px, py, pz);
    camera.lookAt(t.target);
  }
  function tweenTo(target, dist, az, dur, onDone) {
    if (settings.reduceMotion || settings.camFast) {
      camState.target.copy(target); camState.dist = dist; camState.az = az;
      applyCamImmediate();
      if (onDone) onDone();
      return;
    }
    tween.active = true; tween.t = 0; tween.dur = dur || 0.6;
    tween.from = { target: camState.target.clone(), dist: camState.dist, az: camState.az };
    tween.to = { target: target.clone(), dist, az };
    tween.onDone = onDone;
  }
  function stepTween(dt) {
    if (!tween.active) return;
    tween.t += dt;
    let k = Math.min(1, tween.t / tween.dur);
    k = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const f = tween.from, t = tween.to;
    camState.target.lerpVectors(f.target, t.target, k);
    camState.dist = f.dist + (t.dist - f.dist) * k;
    camState.az = f.az + (t.az - f.az) * k;
    applyCamImmediate();
    if (tween.t >= tween.dur) { tween.active = false; if (tween.onDone) { const cb = tween.onDone; tween.onDone = null; cb(); } }
  }

  /* ═══════════════ 拾取 ═══════════════ */
  function updateNDC(e) {
    const r = canvas.getBoundingClientRect();
    mouseNDC.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouseNDC.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }
  function doPick() {
    raycaster.setFromCamera(mouseNDC, camera);
    const hits = raycaster.intersectObjects(pickables, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.pick) o = o.parent;
      if (o && o.userData.pick) {
        if (onPickCb) onPickCb(o.userData.pick);
        return;
      }
    }
    if (onPickCb) onPickCb(null);
  }
  function raycastHover() {
    raycaster.setFromCamera(mouseNDC, camera);
    const hits = raycaster.intersectObjects(pickables, true);
    let found = null;
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.pick) o = o.parent;
      if (o && o.userData.pick) { found = o.userData.pick; break; }
    }
    canvas.classList.toggle('picking', !!found);
    if ((found && (!hovered || found.id !== hovered.id)) || (!found && hovered)) {
      hovered = found;
      if (onHoverCb) onHoverCb(found);
    }
  }

  /* ═══════════════ 层级切换 ═══════════════ */
  function switchLevel(lv, opts) {
    if (lv === level) return;
    const fade = document.getElementById('fader');
    const doSwitch = () => {
      level = lv;
      activeScene = lv === 'world' ? worldScene : theaterScene;
      // 清理军团棋子（切换后重建）
      if (lv === 'theater') {
        camState.target.set(55, 0, 5); camState.dist = 195; camState.az = -0.5; camState.phi = 0.85;
      } else {
        camState.target.set(0, 0, -6); camState.dist = 165; camState.az = -0.5; camState.phi = 0.9;
      }
      if (opts && opts.focus) focusNode(opts.focus, true);
      applyCamImmediate();
      refreshLegions();
      updateLabels();
      if (onLevelCb) onLevelCb(lv);
    };
    if (settings.reduceMotion || settings.camFast) { doSwitch(); }
    else {
      fade.classList.add('on');
      setTimeout(() => { doSwitch(); setTimeout(() => fade.classList.remove('on'), 80); }, 360);
    }
  }

  function focusNode(nodeId, instant) {
    const T = D.theaterHuainan;
    const n = T.nodes[nodeId];
    if (!n) return;
    const w = NODE2W(n);
    const tgt = new THREE.Vector3(w.x, 0, w.z);
    if (instant) { camState.target.copy(tgt); applyCamImmediate(); }
    else tweenTo(tgt, 70, camState.az, 0.6);
  }

  /* ═══════════════ 行军箭头 ═══════════════ */
  function drawMarchArrow(legionId, pathNodes, color) {
    if (!arrowsGroup) return;
    clearMarchArrows(legionId);
    const T = D.theaterHuainan;
    const pts = pathNodes.map(id => {
      const n = T.nodes[id]; if (!n) return null;
      const w = NODE2W(n); return new THREE.Vector3(w.x, 1.4, w.z);
    }).filter(Boolean);
    if (pts.length < 2) return;
    const g = new THREE.Group(); g.userData.legionId = legionId;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({ color: color || 0x984C3F, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.95 })
    );
    line.computeLineDistances();
    g.add(line);
    // 箭头锥
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    const dir = new THREE.Vector3().subVectors(b, a).normalize();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.6, 4, 6), new THREE.MeshBasicMaterial({ color: color || 0x984C3F }));
    cone.position.copy(b.clone().addScaledVector(dir, -2));
    cone.lookAt(b.clone().addScaledVector(dir, 5));
    cone.rotateX(Math.PI / 2);
    g.add(cone);
    arrowsGroup.add(g);
  }
  function clearMarchArrows(legionId) {
    if (!arrowsGroup) return;
    [...arrowsGroup.children].forEach(c => {
      if (legionId == null || c.userData.legionId === legionId) arrowsGroup.remove(c);
    });
  }

  /* ═══════════════ 情报状态联动 ═══════════════ */
  function refreshIntel() {
    if (!mistMesh) return;
    const S = SHL.State.current();
    if (!S) return;
    const st = S.intel.dukou ? S.intel.dukou.state : 'unverified';
    mistTarget = st === 'confirmed' ? 0.3 : st === 'stale' ? 0.88 : 0.78;
    refreshLegions();
  }

  /* ═══════════════ 图层按钮 ═══════════════ */
  function setLayer(name) {
    layerActive = name;
    if (!theaterScene) return;
    const S = SHL.State.current();
    // 粮道层：高亮粮道
    const grainNodes = ['granary', 'liangdao', 'camp', 'dukou'];
    Object.entries(theaterNodeMeshes).forEach(([id, g]) => {
      const on = name === 'supply' && grainNodes.includes(id);
      g.traverse(o => { if (o.isMesh && o.material.emissive) o.material.emissive.setHex(on ? 0x332211 : 0x000000); });
    });
    // 迷雾透明度
    if (mistMesh && S) {
      const st = S.intel.dukou.state;
      let base = st === 'confirmed' ? 0.3 : st === 'stale' ? 0.88 : 0.78;
      if (name === 'intel') base = Math.min(base, 0.25);
      mistTarget = base;
    }
  }

  /* ═══════════════ 渲染循环 ═══════════════ */
  function loop() {
    rafId = requestAnimationFrame(loop);
    const dt = Math.min(0.05, clock.getDelta());
    stepTween(dt);
    const t = clock.elapsedTime;
    // 旗帜微动
    banners.forEach(b => {
      if (!b.flag.parent) return;
      b.flag.rotation.y = Math.sin(t * 1.8 + b.phase) * 0.18;
      b.flag.position.x = 1.3 + Math.sin(t * 2.2 + b.phase) * 0.08;
    });
    waterAnims.forEach(w => { w.mat.opacity = w.base + Math.sin(t * 1.2) * 0.04; });
    if (mistMesh) mistMesh.material.opacity += (mistTarget - mistMesh.material.opacity) * 0.04;
    if (activeScene) renderer.render(activeScene, camera);
    updateLabels();
    updateMinimap();
  }

  /* ═══════════════ 小地图 ═══════════════ */
  let mmCtx = null;
  function updateMinimap() {
    const cv = document.getElementById('mm-canvas');
    if (!cv) return;
    if (!mmCtx) mmCtx = cv.getContext('2d');
    const ctx = mmCtx;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#E7DFC9'; ctx.fillRect(0, 0, cv.width, cv.height);
    const toMM = (wx, wz) => [cv.width / 2 + wx * (cv.width / 420), cv.height / 2 + wz * (cv.height / 340)];
    // 势力斑
    Object.values(D.regions).forEach(r => {
      const fac = D.factions[r.owner];
      ctx.fillStyle = fac ? fac.color + '66' : '#b9b3a255';
      ctx.beginPath();
      ctx.ellipse(r.x * cv.width, r.y * cv.height, 22, 15, 0, 0, 7);
      ctx.fill();
    });
    // 河流
    ctx.strokeStyle = '#657C82'; ctx.lineWidth = 2;
    [[0.145], [0.60], [0.80]].forEach(([v]) => {
      ctx.beginPath();
      ctx.moveTo(0, v * cv.height);
      ctx.bezierCurveTo(cv.width * 0.3, v * cv.height + 4, cv.width * 0.7, v * cv.height - 4, cv.width, v * cv.height);
      ctx.stroke();
    });
    // 视野框
    const [cx, cy] = toMM(camState.target.x, camState.target.z);
    const vw = camState.dist * (cv.width / 420) * 0.55, vh = camState.dist * (cv.height / 340) * 0.55;
    ctx.strokeStyle = '#984C3F'; ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - vw, cy - vh, vw * 2, vh * 2);
    const rect = document.getElementById('mm-rect');
  }

  /* ═══════════════ 城池缩景（详情页） ═══════════════ */
  function createCityScene(canvasEl, hotCb) {
    const ren2 = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
    ren2.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xEAE2CE);
    scene.fog = new THREE.Fog(0xEAE2CE, 60, 160);
    scene.add(new THREE.HemisphereLight(0xFFF8E8, 0x8A7A5C, 1.1));
    const sun = new THREE.DirectionalLight(0xFFF2D8, 0.9); sun.position.set(30, 50, 20); scene.add(sun);
    // 地面
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshLambertMaterial({ color: 0xD9D0B6 }));
    ground.rotation.x = -Math.PI / 2; scene.add(ground);
    // 城池
    const city = buildCityCluster(scene, { x: 0, z: 0 }, 1.6);
    // 教场营地
    const camp = buildCamp(scene, { x: 38, z: -20 }, D.factions.jin.color);
    camp.scale.set(0.9, 0.9, 0.9);
    // 集市（棚摊）
    const mkt = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const stall = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 2.4), MAT.wood);
      stall.position.set((i % 3) * 5 - 5, 1, Math.floor(i / 3) * 6 - 3);
      const awn = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.2, 4), new THREE.MeshLambertMaterial({ color: 0x9C8665, flatShading: true }));
      awn.position.set(stall.position.x, 2.6, stall.position.z); awn.rotation.y = Math.PI / 4;
      mkt.add(stall); mkt.add(awn);
    }
    mkt.position.set(-30, 0.5, 18); scene.add(mkt);
    // 粮仓
    const gr = buildGranary(scene, { x: -34, z: -16 }, null); gr.scale.set(0.8, 0.8, 0.8);
    // 树
    const rnd = mulberry32(5);
    const tgeo = new THREE.ConeGeometry(2, 5.5, 5);
    const tmat = new THREE.MeshLambertMaterial({ color: 0x4F5A4A, flatShading: true });
    for (let i = 0; i < 26; i++) {
      const t = new THREE.Mesh(tgeo, tmat);
      const a = rnd() * Math.PI * 2, r = 48 + rnd() * 26;
      t.position.set(Math.cos(a) * r, 2.6, Math.sin(a) * r);
      t.scale.setScalar(0.7 + rnd() * 0.7);
      scene.add(t);
    }

    const cam2 = new THREE.PerspectiveCamera(42, 2, 0.1, 500);
    let az = 0.7, dist = 78, phi = 0.62, tgt = new THREE.Vector3(0, 4, 0);
    function apply() {
      cam2.position.set(tgt.x + Math.sin(az) * dist * Math.cos(phi), tgt.y + dist * Math.sin(phi), tgt.z + Math.cos(az) * dist * Math.cos(phi));
      cam2.lookAt(tgt);
    }
    apply();

    // 交互：左键旋转，滚轮缩放
    let drag = false, lx = 0;
    canvasEl.addEventListener('mousedown', e => { drag = true; lx = e.clientX; });
    window.addEventListener('mouseup', () => drag = false);
    window.addEventListener('mousemove', e => {
      if (drag) { az += (e.clientX - lx) * 0.008; lx = e.clientX; apply(); }
    });
    canvasEl.addEventListener('wheel', e => {
      e.preventDefault();
      dist = Math.max(40, Math.min(120, dist * (1 + Math.sign(e.deltaY) * 0.1)));
      apply();
    }, { passive: false });

    // 热点标签
    const spots = [
      { id: 'gate', name: '城门', pos: new THREE.Vector3(0, 14, 15) },
      { id: 'granary', name: '粮仓', pos: new THREE.Vector3(-30, 10, -12) },
      { id: 'market', name: '集市', pos: new THREE.Vector3(-27, 8, 20) },
      { id: 'camp', name: '营地', pos: new THREE.Vector3(34, 10, -18) },
    ];
    const host = canvasEl.parentElement.querySelector('.c3d-hots') || canvasEl.parentElement;
    const hotEls = [];
    spots.forEach(s => {
      const el = document.createElement('div');
      el.className = 'city-hot';
      el.innerHTML = `<div class="hot-pin"><i>${s.name[0]}</i></div><div class="hot-name">${s.name}</div>`;
      el.addEventListener('click', () => { SHL.Audio.tick(); hotCb && hotCb(s.id); hotEls.forEach(h => h.classList.remove('active')); el.classList.add('active'); });
      host.appendChild(el);
      hotEls.push(el);
      s.el = el;
    });
    // 标签随镜头投影
    function projectSpots() {
      const rect = canvasEl.getBoundingClientRect();
      if (rect.width === 0) return;
      spots.forEach(s => {
        const v = s.pos.clone().project(cam2);
        if (v.z > 1) { s.el.style.display = 'none'; return; }
        s.el.style.display = 'block';
        s.el.style.left = ((v.x * 0.5 + 0.5) * rect.width) + 'px';
        s.el.style.top = ((-v.y * 0.5 + 0.5) * rect.height) + 'px';
      });
    }
    let raf = 0, alive = true;
    (function r() {
      if (!alive) return;
      raf = requestAnimationFrame(r);
      ren2.setSize(canvasEl.clientWidth, canvasEl.clientHeight, false);
      cam2.aspect = canvasEl.clientWidth / Math.max(1, canvasEl.clientHeight);
      cam2.updateProjectionMatrix();
      ren2.render(scene, cam2);
      projectSpots();
    })();
    return { dispose() { alive = false; cancelAnimationFrame(raf); ren2.dispose(); } };
  }

  /* ═══════════════ 军阵缩景（军团详情页） ═══════════════ */
  function createLegionScene(canvasEl, legion) {
    const ren2 = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
    ren2.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xEAE2CE);
    scene.fog = new THREE.Fog(0xEAE2CE, 50, 150);
    scene.add(new THREE.HemisphereLight(0xFFF8E8, 0x8A7A5C, 1.1));
    const sun = new THREE.DirectionalLight(0xFFF2D8, 0.9); sun.position.set(30, 50, 20); scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshLambertMaterial({ color: 0xD9D0B6 }));
    ground.rotation.x = -Math.PI / 2; scene.add(ground);
    const fac = D.factions[legion.faction];
    const col = new THREE.Color(fac.color);
    // 军阵：按编成分块
    const blocks = [
      { n: 4, rows: 3, label: '步卒', ox: -7, oz: 4 },
      { n: 3, rows: 2, label: '甲骑', ox: 8, oz: 2 },
      { n: 3, rows: 2, label: '强弩', ox: 0, oz: -8 },
    ];
    const geo = new THREE.ConeGeometry(0.9, 3, 5);
    const mat = new THREE.MeshLambertMaterial({ color: col.getHex(), flatShading: true });
    blocks.forEach(b => {
      const inst = new THREE.InstancedMesh(geo, mat, b.n * b.rows);
      const m4 = new THREE.Matrix4();
      let k = 0;
      for (let r = 0; r < b.rows; r++) for (let i = 0; i < b.n; i++) {
        m4.makeRotationY(rnd6());
        m4.setPosition(b.ox + i * 2.4 - b.n * 1.2, 1.5, b.oz + r * 2.6);
        inst.setMatrixAt(k++, m4);
      }
      scene.add(inst);
    });
    addBanner(scene, 0, 0, 6, col.getHex(), 9);
    // 帅旗
    const cmd = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 12, 5), MAT.dark);
    cmd.position.set(6, 6, 8); scene.add(cmd);
    const cmdFlag = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.2), new THREE.MeshBasicMaterial({ color: 0x232826, side: THREE.DoubleSide }));
    cmdFlag.position.set(7.7, 10.8, 8); scene.add(cmdFlag);

    const cam2 = new THREE.PerspectiveCamera(40, 2, 0.1, 500);
    let az = 0.9, dist = 46, phi = 0.55;
    const tgt = new THREE.Vector3(0, 2, 0);
    function apply() {
      cam2.position.set(tgt.x + Math.sin(az) * dist * Math.cos(phi), tgt.y + dist * Math.sin(phi), tgt.z + Math.cos(az) * dist * Math.cos(phi));
      cam2.lookAt(tgt);
    }
    apply();
    let drag = false, lx = 0;
    canvasEl.addEventListener('mousedown', e => { drag = true; lx = e.clientX; });
    window.addEventListener('mouseup', () => drag = false);
    window.addEventListener('mousemove', e => { if (drag) { az += (e.clientX - lx) * 0.008; lx = e.clientX; apply(); } });
    canvasEl.addEventListener('wheel', e => { e.preventDefault(); dist = Math.max(24, Math.min(80, dist * (1 + Math.sign(e.deltaY) * 0.1))); apply(); }, { passive: false });
    function rnd6() { return Math.random() * 6.28; }
    let raf = 0, alive = true;
    (function r() {
      if (!alive) return;
      raf = requestAnimationFrame(r);
      ren2.setSize(canvasEl.clientWidth, canvasEl.clientHeight, false);
      cam2.aspect = canvasEl.clientWidth / Math.max(1, canvasEl.clientHeight);
      cam2.updateProjectionMatrix();
      ren2.render(scene, cam2);
    })();
    return { dispose() { alive = false; cancelAnimationFrame(raf); ren2.dispose(); } };
  }

  /* ═══════════════ 设置 ═══════════════ */
  function applySettings(o) { Object.assign(settings, o); }

  function getLevel() { return level; }

  return {
    init, switchLevel, getLevel, focusNode,
    refreshLegions, refreshIntel, setLayer,
    drawMarchArrow, clearMarchArrows,
    createCityScene, createLegionScene,
    applySettings, settings,
    NODE2W,
    /* 调试钩子（原型用） */
    _dbg: () => ({ activeScene, worldScene, theaterScene, mistMesh, camState, camera }),
  };
})();
