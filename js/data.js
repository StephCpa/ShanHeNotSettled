/* ═════════════════════════════════════════════════
   十六国 · 山河未定 — 世界与剧本数据
   数据对象约定（方案§13）：
   时代与剧本 {年代 初始势力 地域 人物状态 事件条件}
   地域 {稳定ID 邻接 道路 河网 地形包 城关}
   人物 {在世区间 身份 关系 节点条件 史料来源}
   战役与节点 {位置 双方 目标 触发条件 战场种子}
   情报与方案 {观察者 时间 证据源 假设 指令字段}
   ═════════════════════════════════════════════════ */
window.SHL = window.SHL || {};

SHL.DATA = (function () {
  'use strict';

  /* ── 政权 ── */
  const factions = {
    jin:  { id:'jin',  name:'东晋', color:'#984C3F', seal:'晋', borderStyle:'solid',  pattern:'回纹' },
    qin:  { id:'qin',  name:'前秦', color:'#657C82', seal:'秦', borderStyle:'dashed', pattern:'云纹' },
    yan:  { id:'yan',  name:'前燕', color:'#75816B', seal:'燕', borderStyle:'double', pattern:'山纹' },
    wei:  { id:'wei',  name:'北魏', color:'#9C8665', seal:'魏', borderStyle:'solid',  pattern:'兽纹' },
    song: { id:'song', name:'刘宋', color:'#4A4438', seal:'宋', borderStyle:'dashed', pattern:'玄纹' },
    lateryan: { id:'lateryan', name:'后燕', color:'#5E7355', seal:'后燕', borderStyle:'solid', pattern:'山纹' },
  };

  /* ── 人物（在世区间受剧本约束） ── */
  const characters = {
    murongke:  { id:'murongke', name:'慕容恪', born:321, died:367, note:'前燕辅政，卒于367年' },
    murongchui:{ id:'murongchui', name:'慕容垂', born:326, died:396, note:'历前燕·前秦·后燕' },
    fujian:    { id:'fujian', name:'苻坚', born:338, died:385, note:'前秦天王' },
    furong:    { id:'furong', name:'苻融', born:340, died:383, note:'苻坚之弟，殁于淝水' },
    wangmeng:  { id:'wangmeng', name:'王猛', born:325, died:375, note:'卒于375年，383年不在场' },
    xiean:     { id:'xiean', name:'谢安', born:320, died:385, note:'东晋执政' },
    xiexuan:   { id:'xiexuan', name:'谢玄', born:343, died:388, note:'北府兵组建者' },
    liulaozhi: { id:'liulaozhi', name:'刘牢之', born:353, died:402, note:'北府名将' },
    zhuxu:     { id:'zhuxu', name:'朱序', born:317, died:393, note:'原晋将，时在前秦军中' },
    tuobagui:  { id:'tuobagui', name:'拓跋珪', born:371, died:409, note:'北魏道武帝' },
    tuobatao:  { id:'tuobatao', name:'拓跋焘', born:408, died:452, note:'北魏太武帝' },
    liuyu:     { id:'liuyu', name:'刘裕', born:363, died:422, note:'420年前为东晋臣' },
  };

  /* ── 内容篇章（方案§01 表） ── */
  const chapters = [
    {
      id:'yongjia', track:'zhao', trackName:'汉赵·石赵', name:'永嘉与石赵', years:[304,337],
      yearLabel:'304—337', ext:false, later:true,
      regions:['bingzhou','hebei','heluo'],
      focus:'补足时代前史；流民迁徙、坞堡和地方势力',
      chars:['刘渊','石勒','祖逖'],
      tagline:'铁骑踏破两京，衣冠南渡——时代的前史从并州的坞堡炊烟开始。',
      scenarios:[
        { id:'yongjia-1', name:'永嘉之祸', year:311, badge:'后续补篇', locked:true,
          desc:'匈奴汉国围攻洛阳，流民南奔。聚焦坞堡自守与迁徙路线的抉择。' },
      ],
      learn:'流民安置 · 坞堡经营 · 地方势力',
    },
    {
      id:'yan-qi', track:'yan', trackName:'前燕', name:'燕起辽西', years:[337,370],
      yearLabel:'337—370', ext:false,
      regions:['liaoxi','hebei','heluo'],
      focus:'边地经营与南下路线；骑兵展开、粮道和人物关系',
      chars:['慕容恪','慕容垂','慕容儁'],
      tagline:'从辽西边地到幽冀沃野，前燕的骑兵在粮道与人物关系之间寻找南下的路径。',
      scenarios:[
        { id:'yan-1', name:'棘城之围', year:338, badge:'篇章开局', desc:'后赵大军压境，慕容皝据棘城自守，契丹与段部在侧。' },
        { id:'yan-2', name:'中原逐鹿', year:352, badge:'剧情推进', desc:'廉台之战冉闵败亡，前燕入主邺城，重心由边地转向中原。' },
        { id:'yan-3', name:'枋头战役', year:369, badge:'经典战役', desc:'桓温北伐至枋头，断粮判断、殿后与追击——追击战并不在枋头原地。' },
      ],
      learn:'骑兵机动 · 粮道防护 · 慕容兄弟的关系网',
    },
    {
      id:'qin-tong', track:'qin', trackName:'前秦', name:'秦统北方', years:[357,385],
      yearLabel:'357—385', ext:false,
      regions:['guanzhong','heluo','hebei','huainan'],
      focus:'统一战争与治理压力；苻坚和王猛史诗，淝水危局',
      chars:['苻坚','王猛','苻融'],
      tagline:'王猛治关中，苻坚并北方——统一战争的胜利如何变成治理的压力，最终在淮南的一次渡河中见分晓。',
      scenarios:[
        { id:'qin-1', name:'关中治理', year:357, badge:'篇章开局', desc:'苻坚即位，王猛整肃豪右，关中大治。' },
        { id:'qin-2', name:'潞川决战', year:370, badge:'经典战役', desc:'前秦灭前燕：太行隘口运输与集结，潞川关键交锋。' },
        { id:'feishui', name:'淝水危局', year:383, badge:'可游玩', playable:true,
          desc:'八万北府兵对号称百万之众。洛涧首胜之后，秦军沿淝水列阵，渡口与粮道成为全局关键。' },
      ],
      learn:'统一战争的补给 · 治理压力 · 渡河交战',
    },
    {
      id:'wei-qi', track:'wei', trackName:'北魏', name:'魏起代北', years:[386,439],
      yearLabel:'386—439', ext:false,
      regions:['daibei','hebei','guanzhong','hexi'],
      focus:'军团机动与多个战区；拓跋珪到拓跋焘的世代接续',
      chars:['拓跋珪','拓跋焘','崔浩'],
      tagline:'自代北草地而起，两代人接续经营，直到北方重归一统。',
      scenarios:[
        { id:'wei-1', name:'代北复国', year:386, badge:'篇章开局', desc:'拓跋珪重建代国，联盟与驻地选择的权衡。' },
        { id:'wei-2', name:'参合陂', year:395, badge:'经典战役', desc:'情报与疲劳的致命叠加：追击，还是有序撤退。' },
        { id:'wei-3', name:'平定北凉', year:439, badge:'经典战役', desc:'河西走廊上的水源争夺与远征节奏。' },
      ],
      learn:'多战区机动 · 世代接续 · 远征补给',
    },
    {
      id:'jinsong', track:'jin', trackName:'东晋·刘宋', name:'晋宋北望', years:[404,439],
      yearLabel:'404—439', ext:false,
      regions:['huainan','qingxu','heluo','guanzhong'],
      focus:'刘裕北伐与政权转变；水陆补给、占领和撤守',
      chars:['刘裕','王镇恶','檀道济'],
      tagline:'气吞万里如虎——水陆并进的北伐，以及关中留守的难题。420年后政权视角转为刘宋。',
      scenarios:[
        { id:'js-1', name:'京口举义', year:404, badge:'篇章开局', desc:'刘裕起兵讨桓玄，北府旧部重聚。' },
        { id:'js-2', name:'广固围城', year:409, badge:'经典战役', desc:'围城补给、工程准备与城门突破。' },
        { id:'js-3', name:'北伐后秦', year:416, badge:'经典战役', desc:'水陆协同入洛陕，攻城与关中留守的两难。' },
      ],
      learn:'水陆补给 · 占领与撤守 · 身份时间轴',
    },
    {
      id:'songwei', track:'songwei', trackName:'宋·魏', name:'宋魏争锋', years:[440,451],
      yearLabel:'440—451 · 扩展', ext:true,
      regions:['heluo','huaisi','changjiangbei'],
      focus:'与北魏篇并行；多路作战、河防和战争消耗',
      chars:['刘义隆','拓跋焘','王玄谟'],
      tagline:'元嘉北伐与瓜步之战——两分的天下在河淮之间反复拉锯。',
      scenarios:[
        { id:'sw-1', name:'元嘉北伐', year:450, badge:'扩展篇章', locked:true, desc:'多路出击滑台，进抵瓜步——前进补给与撤军的两难。' },
      ],
      learn:'多线防御 · 前进补给 · 撤军组织',
    },
  ];

  /* ── 地域（天下总览） ── */
  const regions = {
    liaoxi:  { id:'liaoxi',  name:'辽西与幽冀', short:'辽西', x:0.78, y:0.22, terrain:'丘陵 旱田 河谷 边城', use:'骑兵机动与南下补给', owner:'yan' },
    hebei:   { id:'hebei',   name:'河北与太行东麓', short:'河北', x:0.68, y:0.36, terrain:'平原 隘口 坞堡', use:'山口控制与多城协防', owner:'qin' },
    guanzhong:{ id:'guanzhong', name:'关中与陇右', short:'关中', x:0.36, y:0.38, terrain:'黄土台塬 河谷 关隘', use:'粮仓 纵深防御 东西转运', owner:'qin' },
    heluo:   { id:'heluo',   name:'河洛', short:'河洛', x:0.52, y:0.42, terrain:'大河渡口 城塞 盆地', use:'交通枢纽与跨河战线', owner:'qin' },
    daibei:  { id:'daibei',  name:'代北与河套', short:'代北', x:0.42, y:0.16, terrain:'草地 台地 寒地河流', use:'马匹补给 冬季行军', owner:null, ext:'386年后可入' },
    huainan: { id:'huainan', name:'淮南与青徐', short:'淮南', x:0.62, y:0.60, terrain:'河汊 湿地 农田 城壕', use:'渡河 护粮 水陆协同', owner:'jin' },
    jiangnan:{ id:'jiangnan',name:'江南与荆襄', short:'江南', x:0.56, y:0.80, terrain:'丘陵 水网 港埠 山口', use:'漕运 防御纵深与人口安置', owner:'jin' },
    hexi:    { id:'hexi',    name:'河西与巴蜀', short:'河西', x:0.14, y:0.42, terrain:'绿洲走廊 或 山地盆地', use:'水源争夺 或 栈道运输', owner:null, ext:'独立扩展包' },
  };

  /* ── 淮南战区节点（战区沙盘） ── */
  const theaterHuainan = {
    id:'huainan', name:'淮南', riverName:'淝水', bigRiver:'淮水',
    nodes: {
      shouyang:  { id:'shouyang',  name:'寿阳', type:'city',   x:520, y:300, desc:'淮南重镇，城坚粮足', population:42000 },
      dukou:     { id:'dukou',     name:'淝水渡口', type:'crossing', x:430, y:430, desc:'淝水浅滩，渡河必经' },
      bagong:    { id:'bagong',    name:'八公山', type:'hill',  x:575, y:395, desc:'草木皆兵之处，可眺西岸' },
      camp:      { id:'camp',      name:'东岸大营', type:'camp',  x:650, y:470, desc:'北府军主力驻地' },
      granary:   { id:'granary',   name:'石仓粮囤', type:'granary', x:760, y:560, desc:'粮道终点，存粮集中' },
      liangdao:  { id:'liangdao',  name:'粮道·三汊河', type:'road', x:640, y:610, desc:'自江南溯淮转运的节点' },
      qianxian:  { id:'qianxian',  name:'洛涧', type:'river', x:330, y:250, desc:'秦军前哨据点，已为我军所破' },
      reed:      { id:'reed',      name:'苇泽', type:'marsh', x:480, y:545, desc:'芦苇湿地，辎重难行' },
    },
    roads: [
      ['shouyang','dukou'], ['shouyang','bagong'], ['bagong','camp'],
      ['camp','granary'], ['camp','liangdao'], ['granary','liangdao'],
      ['dukou','reed'], ['reed','liangdao'], ['shouyang','qianxian'], ['dukou','bagong'],
    ],
  };

  /* ── 军团 ── */
  const legions = {
    beifu: { id:'beifu', name:'北府先锋营', faction:'jin', node:'camp',
      general:'liulaozhi', commander:'xiexuan',
      infantry:1800, cavalry:600, archer:600, morale:82, fatigue:22,
      supplyDays:24, stance:'steady',
      note:'谢玄亲练北府兵，甲仗精利' },
    bagongshan: { id:'bagongshan', name:'八公山驻营', faction:'jin', node:'bagong',
      general:'xiexuan', commander:'xiean',
      infantry:1400, cavalry:200, archer:900, morale:74, fatigue:15,
      supplyDays:30, stance:'steady',
      note:'凭山设垒，观察西岸' },
    scouts: { id:'scouts', name:'斥候乙队', faction:'jin', node:'dukou',
      general:null, commander:'liulaozhi',
      infantry:120, cavalry:180, archer:0, morale:80, fatigue:35,
      supplyDays:6, stance:'fast', scout:true,
      note:'轻骑侦逻，一刻可抵渡口' },
    transport: { id:'transport', name:'石仓运输队', faction:'jin', node:'liangdao',
      general:null, commander:null,
      infantry:300, cavalry:0, archer:0, morale:60, fatigue:10,
      supplyDays:99, stance:'steady', transport:true, grainLoad:3000,
      note:'粮车两百乘，行速受路况限制' },
    qinvanguard: { id:'qinvanguard', name:'秦军前锋（情报）', faction:'qin', node:'dukou',
      intel:true, estimate:'兵力未辨 · 炊烟数十处', strengthGuess:[2000,4000], confirmed:false,
      note:'来源：斥候乙队一日前观察' },
  };

  /* ── 淝水危局：军议 ── */
  const council = {
    scenario:'feishui',
    evidence: {
      id:'ev-dukou', title:'渡口敌情待核',
      source:'斥候乙队', observed:'一日前', received:'今晨', place:'淝水西岸渡口',
      content:'见西岸炊烟数十处，旗鼓不辨，未确认兵力。',
      judgement:'尚未交叉验证', impact:'若敌军聚渡，粮道将受威胁',
      aiNote:'AI 可提出「可能存在营地」，不能把炊烟直接换算成确定兵力。',
      sameOriginNote:'今晨船家所言「西岸有兵」与斥候同源，不构成独立证据。',
    },
    councilors: [
      { char:'liulaozhi', role:'斥候主官', view:'渡口苇深岸窄，若敌先据，大军渡河必乱。<span class="ev">建议先增斥候，核实再动。</span> 未知：敌军是否已有浮桥。', bias:'主张谨慎，先求不败' },
      { char:'xiexuan', role:'前锋统帅', view:'八万对百万，利在速决而不在浪战。<span class="ev">粮道若断，不战自溃。</span> 未知：敌前锋虚实。', bias:'倾向冒险，寻求战机' },
      { char:'xiean', role:'都督军需', view:'石仓屯粮九千石，支至冬初。<span class="ev">护粮为上，粮在军稳。</span> 未知：江南漕运受淮口风浪影响。', bias:'稳健持重，惜力不打险仗' },
      { char:'zhuxu', role:'归正之人（前秦军中）', view:'秦军虽众，号令不一。<span class="unk">所知限于旧年见闻，请勿全信。</span>', bias:'情报有利益偏向，需核', disputed:true },
      { char:'wangmeng', role:'丞相（卒于375年）', dead:true, deadNote:'卒于375年，383年军议不设此席。' },
    ],
    proposals: [
      { id:'A', name:'增派侦察后行动', kind:'侦察优先',
        relies:'依赖：斥候乙队当日回报', cost:'耗时1回合 · 粮耗少',
        risk:'若敌先行渡河，将失先机', fallback:'退路：东岸大营可守',
        givesUp:'放弃：短期内的任何进攻机会',
        preview:'绘出斥候往返路线，渡口情报更新后再定行止。' },
      { id:'B', name:'改道行军', kind:'规避接敌',
        relies:'依赖：上游浅滩情报（未核实）', cost:'多耗3日粮 · 苇泽绕行',
        risk:'湿地减速，辎重易陷；且该路未侦察', fallback:'退路：随时折回官道',
        givesUp:'放弃：渡口通道的主动权',
        preview:'绘出经苇泽北侧的绕行路线，粮耗与时长同步上升。' },
      { id:'C', name:'以一部掩护运输', kind:'护粮决战',
        relies:'依赖：北府先锋营护送', cost:'即刻触发渡口交锋',
        risk:'正面接敌，有伤亡；敌若重兵，护送可能失败', fallback:'退路：放弃部分辎重，提前撤离',
        givesUp:'放弃：本回合其余方向的一切行动',
        preview:'绘出运输队沿粮道至渡口的护送路线与接敌区。' },
    ],
  };

  /* ── 渡口护粮·即时交锋配置（战场种子固定，保证重载一致） ── */
  const battleDukou = {
    id:'battle-dukou', seed:20261024, name:'淝水渡口 · 护粮',
    objective:'护送运输队从东岸粮道通过渡口，抵达西岸撤离点',
    objectiveOpt:'可选目标：辎重保存过半 · 撤离伤员',
    commander:'liulaozhi', commanderName:'刘牢之',
    timeLimit:300, // 5分钟
    playerUnits: [
      { id:'p1', name:'前锋甲营', type:'infantry', strength:600, morale:82, fatigue:20, formation:'横阵', start:[0.40,0.66] },
      { id:'p2', name:'前锋乙营', type:'infantry', strength:550, morale:80, fatigue:20, formation:'横阵', start:[0.50,0.58] },
      { id:'p3', name:'北府弩手', type:'archer',   strength:300, morale:78, fatigue:15, formation:'散阵', start:[0.42,0.46] },
      { id:'p4', name:'亲卫骑兵', type:'cavalry',  strength:260, morale:85, fatigue:25, formation:'楔形', start:[0.56,0.44] },
      { id:'p5', name:'预备队·丁营', type:'infantry', strength:450, morale:70, fatigue:5, formation:'方阵', start:[0.64,0.68], reserve:true },
      { id:'p6', name:'石仓运输队', type:'wagon',   strength:500, morale:60, fatigue:10, formation:'纵队', start:[0.46,0.60], isConvoy:true },
    ],
    enemyUnits: [
      { id:'e1', name:'秦军前锋骑', type:'cavalry',  strength:520, morale:80, fatigue:30, start:[0.20,0.36] },
      { id:'e2', name:'秦军前军步', type:'infantry', strength:700, morale:78, fatigue:25, start:[0.12,0.55] },
      { id:'e3', name:'秦军弓手', type:'archer',   strength:300, morale:72, fatigue:20, start:[0.08,0.42] },
      { id:'e4', name:'秦军预备队', type:'infantry', strength:500, morale:65, fatigue:10, start:[0.05,0.24], reserve:true },
    ],
    terrain:{ crossing:[0.36,0.52], riverAngle:0.46, woodsEast:[0.62,0.72], woodsWest:[0.18,0.30], hill:[0.55,0.22] },
    exitZone:{ x1:0.02, y1:0.34, x2:0.10, y2:0.60 },
  };

  /* ── 城池详情（寿阳） ── */
  const cityShouyang = {
    id:'shouyang', name:'寿阳', faction:'jin', population:42000, refugees:6800, capacity:52000,
    grain:9200, grainIn:260, grainOut:340, transportTeams:2, roadState:'良好',
    conscripts:1200, gear:'七成', horses:180, trainingQueue:[{name:'北府新卒', turns:2, count:500}],
    wallLevel:'三丈夯土', wallDamage:'东垣微损', engineers:200,
    magistrate:'田洛（太守）', gentry:'淮南陈氏·雷氏', pledges:'保境输粮，请兵护送秋赋',
    hotspots:['gate','granary','market','camp'],
  };

  return { factions, characters, chapters, regions, theaterHuainan, legions, council, battleDukou, cityShouyang };
})();
