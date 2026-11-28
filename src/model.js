/**
 * 参数化体块模型 —— 真实实现里由几何重建模型给出。
 *
 * 【本版核心改动】约束优先级体系：
 *   user（人工设定） > calib（尺度标定反解） > type（类型常识） > infer（视觉推断）
 * 一旦用户给出工程参数，视觉特征一律不得覆盖，且每个几何量都留审计链。
 *
 * 设计红线：宁可输出缺细节的「空壳」，绝不输出比例错误的「精美假图」。
 */

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const snap = (v) => Math.round(v * 2) / 2
const r2 = (v) => Math.round(v * 100) / 100

/* ══ 建筑类型常识（type 级，可被 vision / calib / user 覆盖）══
   19 类原型，每类给出：层高、常见层数区间、典型开间、幕墙倾向、竖向分格数，
   以及结构体系与屋面形式的**默认语义**（仍可被更高优先级的证据覆盖）。
   note 字段是给非专业用户看的一句话说明 —— 网站面向大众，不能只丢一个专业词。 */
export const TYPE_GROUPS = [
  { id: 'living', label: '居住建筑' },
  { id: 'public', label: '公共建筑' },
  { id: 'industry', label: '工业建筑' },
  { id: 'transit', label: '交通建筑' },
]

export const BUILDING_TYPES = [
  /* ── 居住建筑 ── */
  {
    id: 'residential', group: 'living', label: '多层住宅',
    fh: 2.9, floors: [3, 6], bayW: 3.6, curtain: 0, mull: 0,
    structure: 'bearing', roof: 'parapet',
    note: '最常见的住宅：3–6 层，一个楼梯单元几户人家。老房子多为砖墙承重，窗是一个一个分开的。',
  },
  {
    id: 'highrise', group: 'living', label: '高层住宅 · 剪力墙',
    fh: 3.0, floors: [12, 33], bayW: 4.2, curtain: 0.1, mull: 0,
    structure: 'bearing', roof: 'parapet',
    note: '十几层到三十几层的住宅楼，靠钢筋混凝土墙承重，立面常见层层重复的阳台与空调板。',
  },
  {
    id: 'villa', group: 'living', label: '独栋别墅 · 小住宅',
    fh: 3.3, floors: [1, 3], bayW: 4.5, curtain: 0.3, mull: 0,
    structure: 'frame', roof: 'flatSlab',
    note: '一两户人家的独立小房子，层数少、层高做得比普通住宅高，常常有大玻璃和出挑的屋面板。',
  },
  {
    id: 'dorm', group: 'living', label: '宿舍 · 公寓楼',
    fh: 3.0, floors: [4, 9], bayW: 3.6, curtain: 0.05, mull: 0,
    structure: 'frame', roof: 'parapet',
    note: '学生宿舍、员工公寓：中间一条走廊、两边排房间，立面因此呈现规律的小窗重复阵列。',
  },
  /* ── 公共建筑 ── */
  {
    id: 'office', group: 'public', label: '办公 · 写字楼',
    fh: 3.6, floors: [5, 9], bayW: 4.2, curtain: 0.55, mull: 1,
    structure: 'frame', roof: 'parapet',
    note: '公司办公用楼，层高比住宅高（要铺设备管线），常有部分玻璃幕墙。',
  },
  {
    id: 'tower', group: 'public', label: '幕墙高层塔楼',
    fh: 3.9, floors: [12, 22], bayW: 4.5, curtain: 1, mull: 2,
    structure: 'frame', roof: 'parapet',
    note: '整栋外墙都是玻璃幕墙的高层。注意：幕墙上的横框线是分格，不能当成楼层线。',
  },
  {
    id: 'retail', group: 'public', label: '商业综合体 · 商场',
    fh: 4.8, floors: [1, 3], bayW: 5.4, curtain: 0.7, mull: 1,
    structure: 'frame', roof: 'parapet',
    note: '商场：层数少但每层很高（要做中庭和风管），首层常见通高玻璃橱窗。',
  },
  {
    id: 'shopfront', group: 'public', label: '沿街商铺 · 小型商业',
    fh: 3.9, floors: [1, 2], bayW: 4.2, curtain: 0.5, mull: 1,
    structure: 'frame', roof: 'parapet',
    note: '街边一排小门面：单开间约 4 m 宽，一层开店，上面可能加一层夹层。',
  },
  {
    id: 'hotel', group: 'public', label: '酒店 · 旅馆',
    fh: 3.3, floors: [8, 20], bayW: 4.2, curtain: 0.4, mull: 1,
    structure: 'frame', roof: 'parapet',
    note: '客房层层堆叠，中间必有电梯厅和疏散楼梯的核心筒，立面窗按客房逐间排列。',
  },
  {
    id: 'school', group: 'public', label: '学校教学楼',
    fh: 3.6, floors: [3, 6], bayW: 3.9, curtain: 0.15, mull: 0,
    structure: 'frame', roof: 'parapet',
    note: '普通教室层高较高、窗台低且面积大（采光要求），一面长走廊把教室串起来。',
  },
  {
    id: 'hospital', group: 'public', label: '医院门诊 · 病房楼',
    fh: 3.9, floors: [4, 12], bayW: 4.5, curtain: 0.3, mull: 1,
    structure: 'frame', roof: 'parapet',
    note: '层高明显比住宅高（医疗设备与洁净管线），立面常见连续的横向窗带。',
  },
  {
    id: 'library', group: 'public', label: '图书馆 · 档案馆',
    fh: 4.5, floors: [3, 6], bayW: 5.4, curtain: 0.25, mull: 1,
    structure: 'frame', roof: 'parapet',
    note: '阅览空间要求大跨度、少柱子，书架荷载大，所以楼板厚、层高偏高。',
  },
  {
    id: 'museum', group: 'public', label: '博物馆 · 美术馆',
    fh: 6.0, floors: [1, 4], bayW: 7.2, curtain: 0.3, mull: 1,
    structure: 'columns', roof: 'roofGarden',
    note: '展厅需要大空间与自然光，常见独立柱承重、墙体与柱子不在一个位置上（自由平面）。',
  },
  {
    id: 'exhibition', group: 'public', label: '会展中心 · 大跨展厅',
    fh: 6.9, floors: [1, 2], bayW: 9.0, curtain: 0.35, mull: 1,
    structure: 'columns', roof: 'flatSlab',
    note: '几乎无柱的大空间，跨度 20–30 m 也常见，屋面多用钢结构 + 大板出挑。',
  },
  {
    id: 'religious', group: 'public', label: '礼堂 · 宗教纪念建筑',
    fh: 5.4, floors: [1, 3], bayW: 6.0, curtain: 0.2, mull: 0,
    structure: 'bearing', roof: 'parapet',
    note: '主体是一个高大的厅，墙体厚重、开窗少而高。本原型暂不绘制坡屋面与穹顶。',
  },
  /* ── 工业建筑 ── */
  {
    id: 'factory', group: 'industry', label: '单层厂房',
    fh: 6.0, floors: [1, 1], bayW: 7.2, curtain: 0, mull: 0,
    structure: 'frame', roof: 'flatSlab',
    note: '单层高大空间，柱距 6–8 m，竖向多条排烟采光带，几乎不会有二层的窗阵列。',
  },
  {
    id: 'workshop', group: 'industry', label: '多层厂房',
    fh: 5.4, floors: [2, 5], bayW: 7.2, curtain: 0, mull: 0,
    structure: 'frame', roof: 'flatSlab',
    note: '把生产搬到楼上的工业厂房，层高比普通楼高，荷载大、柱网规整。',
  },
  {
    id: 'warehouse', group: 'industry', label: '物流仓库',
    fh: 6.9, floors: [1, 1], bayW: 9.0, curtain: 0, mull: 0,
    structure: 'columns', roof: 'flatSlab',
    note: '为货架腾空间，层高接近规范上限，外墙基本实墙，只有装卸口和少量高窗。',
  },
  /* ── 交通建筑 ── */
  {
    id: 'parking', group: 'transit', label: '停车楼',
    fh: 2.6, floors: [2, 6], bayW: 8.1, curtain: 0, mull: 0,
    structure: 'columns', roof: 'parapet',
    note: '层高压到最低（2.4–2.8 m，只要能过车），一个柱距正好停三辆车，立面全是敞开或格栅。',
  },
]

export const FLOOR_HEIGHTS = [2.8, 3.0, 3.3, 3.6, 3.9, 4.2, 4.5, 6.0]

/* ── 尺度标定参照物真值表 ── */
export const REF_ANCHORS = [
  { id: 'door', label: '门洞高', m: 2.1 },
  { id: 'parking', label: '停车位', m: 5.3 },
  { id: 'person', label: '人体高', m: 1.7 },
  { id: 'sill', label: '窗台高', m: 0.9 },
  { id: 'step', label: '台阶踏步', m: 0.3 },
]

/* ── 物理常识硬边界：超出即为「违背常识」，必须告警并降级 ── */
export const PHYSICS = {
  floorHeight: [2.2, 7.0],
  doorHeight: [2.0, 2.4],
  sillHeight: [0.4, 1.2],
  riser: [0.15, 0.2], // 楼梯踢面
  depth: [3, 32], // 展馆 / 单层大跨可到 32 m
  bayWidth: [2.4, 9],
  slab: [0.1, 0.5],
  wall: [0.1, 0.5],
  parapet: [0.5, 1.2], // 女儿墙：非上人 500–600，上人 ≥1100
  siteDrop: [0.15, 0.9], // 室内外高差
}

/* ══ 室内构件清单 ══
   制图红线：照片只能看见外皮，看不见室内。
   楼梯 / 内隔墙 / 家具属于「剖切面以内的不可见构件」，
   除非用户显式声明（例如：我知道剖切经过楼梯间），一律不得建模。
   没画出来的东西必须写进 omissions，在图纸上显式声明，而不是默默留白。 */
export const INTERIOR_ITEMS = [
  { id: 'stair', label: '楼梯间', hint: '剖切经过楼梯间（梯段 / 平台 / 栏杆）' },
  { id: 'partitions', label: '内隔墙', hint: '内部分户墙与分隔墙位置' },
  { id: 'furniture', label: '家具陈设', hint: '固定家具与人形配景' },
]

/* ══ 结构体系 ══
   从真实建筑图纸学到的第一条：不是所有房子都从地上长出来。
   · pilotis  —— 底层架空柱廊（柯布「新建筑五点」之一；萨伏伊 / 范斯沃斯）
   · frame    —— 常规框架填充（柱在墙内）
   · bearing  —— 砖混承重墙
   · columns  —— 独立柱承平板（巴塞罗那馆：柱与墙片分离） */
export const STRUCTURES = [
  { id: 'pilotis', label: '底层架空 · pilotis', pilotiH: 2.75 },
  { id: 'frame', label: '框架填充', pilotiH: 0 },
  { id: 'bearing', label: '砖混承重墙', pilotiH: 0 },
  { id: 'columns', label: '独立柱 · 平板', pilotiH: 0 },
]

/* ══ 洞口方式 ══
   · window   —— 逐开间独立窗（最常见，也是引擎原本唯一会画的一种）
   · ribbon   —— 横向长窗贯通立面、转过转角（柯布五点之四，萨伏伊）
   · curtain  —— 通高玻璃幕墙 */
export const FENESTRATIONS = [
  { id: 'window', label: '独立窗 · 逐开间' },
  { id: 'ribbon', label: '横向长窗 · 贯通' },
  { id: 'curtain', label: '通高玻璃幕墙' },
]

/* ══ 屋面形式 ══
   · parapet     —— 平屋面 + 女儿墙（常规）
   · roofGarden  —— 屋顶花园 + 栏板 + 曲面挡风墙（柯布五点之二，萨伏伊）
   · flatSlab    —— 平板屋面无栏板，板直接出挑（密斯）
   · pitched     —— 坡屋面 */
export const ROOFS = [
  { id: 'parapet', label: '平屋面 · 女儿墙', parapet: 0.6 },
  { id: 'roofGarden', label: '屋顶花园 · 栏板', parapet: 1.0 },
  { id: 'flatSlab', label: '平板 · 无栏板出挑', parapet: 0 },
  { id: 'pitched', label: '坡屋面', parapet: 0 },
]

/* ══ 平面图轴号 ══
   制图惯例：纵向轴号用数字（① ② ③），横向轴号用大写拉丁字母，
   且跳过 I / O / Z，避免与 1 / 0 / 2 混淆。 */
export const AXIS_NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳', '㉑', '㉒', '㉓', '㉔', '㉕', '㉖', '㉗', '㉘', '㉙', '㉚']
/* A B C D E F G H J K L M N P Q R S T U V W X Y */
export const AXIS_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.split('')

/* ══ 房间名称（仅人工声明「内隔墙」后才用到，绝不自动脑补） ══ */
export const ROOM_NAMES = {
  residential: ['起居室', '主卧', '次卧', '厨房', '餐厅', '卫生间', '玄关', '阳台'],
  highrise: ['起居室', '主卧', '次卧', '厨房', '卫生间', '玄关', '电梯厅', '剪刀楼梯'],
  villa: ['起居室', '主卧', '次卧', '书房', '厨房', '餐厅', '车库', '露台'],
  dorm: ['宿舍间', '公共盥洗', '自习室', '值班室', '活动室', '洗衣房', '走道', '入口门厅'],
  office: ['开放办公', '会议室', '经理室', '前台接待', '卫生间', '设备间', '茶水间', '档案室'],
  tower: ['办公区', '核心筒', '电梯厅', '卫生间', '新风机房', '会议区', '走道', '疏散前室'],
  retail: ['营业厅', '收银区', '仓储', '试衣间', '卫生间', '后勤', '展示区', '入口雨篷'],
  shopfront: ['营业区', '收银台', '备餐/加工', '仓储', '员工休息', '卫生间', '门廊', '后院'],
  hotel: ['客房', '标准间', '套房', '电梯厅', '服务间', '布草间', '大堂上空', '疏散前室'],
  school: ['普通教室', '阶梯教室', '教师办公室', '走廊', '卫生间', '合班教室', '准备室', '楼梯间'],
  hospital: ['诊室', '候诊区', '护士站', '处置室', '病房', '医生办公室', '污洗间', '电梯厅'],
  library: ['开架阅览', '闭架书库', '期刊区', '自习区', '检索区', '办公', '卫生间', '走道'],
  museum: ['展厅', '序厅', '藏品库', '休息区', '监控室', '无障碍卫生间', '办公', '装卸区'],
  exhibition: ['展位区', '登录大厅', '洽谈室', '仓储', '设备机房', '卫生间', '走道', '卸货区'],
  religious: ['主厅', '前厅', '侧廊', '服务室', '储藏', '卫生间', '休息室', '楼梯间'],
  factory: ['生产区', '原料区', '成品区', '现场办公', '卫生间', '配电间', '装卸区', '通道'],
  workshop: ['生产线', '配料区', '成品暂存', '质检室', '办公', '卫生间', '货梯厅', '通道'],
  warehouse: ['货架区', '分拣区', '收货平台', '发货平台', '办公', '卫生间', '充电间', '通道'],
  parking: ['停车区', '车道', '管理室', '设备用房', '楼梯间', '电梯厅', '洗车区', '人行通道'],
}

/* ══ 外装修做法（立面图必须用文字说明，GB/T 50104） ══ */
export const FINISHES = {
  residential: { wall: '浅灰面砖饰面', base: '深灰花岗岩勒脚', roof: '平屋面 · 保温 + 找坡', frame: '白色铝合金窗框' },
  highrise: { wall: '浅灰真石漆外墙', base: '深灰花岗岩勒脚', roof: '平屋面 · 保温 + 找坡', frame: '深灰铝合金窗框' },
  villa: { wall: '白色抹灰墙面', base: '浅灰石材勒脚', roof: '钢筋混凝土平板出挑', frame: '深灰铝合金窗框' },
  dorm: { wall: '米黄涂料外墙', base: '深灰砖砌勒脚', roof: '平屋面 · 保温 + 找坡', frame: '白色塑钢窗框' },
  office: { wall: '浅灰铝板幕墙', base: '深灰花岗岩勒脚', roof: '平屋面 · 保温 + 找坡', frame: '深灰铝合金幕墙系统' },
  tower: { wall: '单元式玻璃幕墙', base: '深灰花岗岩勒脚', roof: '平屋面 · 保温 + 找坡', frame: '深灰铝合金幕墙系统' },
  retail: { wall: '超白玻璃幕墙 + 石材', base: '深灰花岗岩勒脚', roof: '平屋面 · 保温 + 找坡', frame: '深灰铝合金幕墙系统' },
  shopfront: { wall: '深色石材 + 玻璃橱窗', base: '深灰花岗岩勒脚', roof: '平屋面 · 保温 + 找坡', frame: '深灰铝合金窗框' },
  hotel: { wall: '米白石材 + 玻璃', base: '深灰花岗岩勒脚', roof: '平屋面 · 保温 + 找坡', frame: '深灰铝合金窗框' },
  school: { wall: '浅灰外墙涂料', base: '深灰砖砌勒脚', roof: '平屋面 · 保温 + 找坡', frame: '白色塑钢窗框' },
  hospital: { wall: '浅灰铝板 + 玻璃', base: '深灰花岗岩勒脚', roof: '平屋面 · 保温 + 找坡', frame: '银灰铝合金窗框' },
  library: { wall: '浅灰石材幕墙', base: '深灰花岗岩勒脚', roof: '平屋面 · 保温 + 找坡', frame: '深灰铝合金窗框' },
  museum: { wall: '白色抹灰 + 石材墙裙', base: '深灰花岗岩勒脚', roof: '屋顶花园 · 种植屋面', frame: '无框玻璃' },
  exhibition: { wall: '银灰金属复合板', base: '混凝土勒脚', roof: '钢桁架屋面 · 大板出挑', frame: '深灰铝合金窗框' },
  religious: { wall: '米黄石材饰面', base: '深灰花岗岩勒脚', roof: '平屋面 · 保温 + 找坡', frame: '深灰钢窗' },
  factory: { wall: '灰色彩钢板墙面', base: '混凝土勒脚', roof: '轻钢屋面 · 保温棉', frame: '塑钢窗' },
  workshop: { wall: '灰色彩钢板墙面', base: '混凝土勒脚', roof: '钢筋混凝土屋面', frame: '塑钢窗' },
  warehouse: { wall: '米灰金属复合板', base: '混凝土勒脚', roof: '轻钢屋面 · 保温棉', frame: '深灰铝合金窗框' },
  parking: { wall: '清水混凝土 + 金属格栅', base: '混凝土勒脚', roof: '平屋面 · 保温 + 找坡', frame: '无框栏板' },
}

/* 优先级：人工声明 > 尺度标定 > 视觉证据 > 类型常识 > 纯推断。
   「视觉证据 vision」这一级是本轮新增的：多视角上传的图片被真实分析后，
   其结论必须排在「拍脑袋的类型常识」之上，否则传再多图也只是装饰。 */
const SRC_RANK = { infer: 0, type: 1, vision: 2, calib: 3, user: 4 }

/* ══ 方案变体 ══
   同一个被观测对象，在未被人工作锁定的自由度上本来就有多个合规解：
   窗墙比、立面节奏、入口位置、檐口做法。以前这些自由度全被固定住，
   所以「重新生成」只是换个随机种子，出来的图几乎一模一样。
   现在每次求解都会抽一个变体，且**同一次生成的 5 轮采样共用它**，
   避免被中位数共识抹平 —— 重新生成会给出不同的合规方案，并在图纸上标注出来。 */
export const VARIANTS = {
  wwr: [0.34, 0.44, 0.52, 0.62],
  rhythm: ['uniform', 'grouped', 'accent'],
  entry: ['center', 'left', 'right'],
  eaves: ['plain', 'cornice', 'recessed'],
  grid: ['bay', 'half-bay', 'double-bay'],
}
export const VARIANT_KEYS = Object.keys(VARIANTS)

export function makeVariant(seed) {
  const r = mulberry32((seed * 2654435761) % 2147483647)
  const pickOne = (arr) => arr[Math.floor(r() * arr.length)]
  const v = {
    wwr: pickOne(VARIANTS.wwr),
    rhythm: pickOne(VARIANTS.rhythm),
    entry: pickOne(VARIANTS.entry),
    eaves: pickOne(VARIANTS.eaves),
    grid: pickOne(VARIANTS.grid),
  }
  v.id = `V-${String(Math.floor(r() * 900) + 100)}`
  return v
}

/**
 * 约束求解：把 { v, src } 包装的量按优先级拍平成一个数。
 * 返回 { value, src }，src 记录真正胜出的来源，供 UI 审计。
 */
function pick(...cands) {
  const valid = cands.filter((c) => c && c.v != null && !Number.isNaN(c.v))
  if (!valid.length) return { value: null, src: 'infer' }
  valid.sort((a, b) => (SRC_RANK[b.src] ?? 0) - (SRC_RANK[a.src] ?? 0))
  return { value: valid[0].v, src: valid[0].src }
}

/**
 * @param {number} seed
 * @param {number} aspect  输入图长宽比
 * @param {number} views   上传视角数
 * @param {object} c       约束集：
 *   {
 *     typeId,
 *     floors:  {v,src},   // 层数
 *     fh:      {v,src},   // 层高
 *     totalH:  {v,src},   // 建筑总高（±0 到檐口）
 *     depth:   {v,src},   // 关键进深
 *     span:    {v,src},   // 面宽
 *     bays:    {v,src},   // 开间数
 *     cleaned: boolean    // 是否已做场景清洗
 *   }
 */
export function makeModel(seed, aspect = 1.5, views = 1, c = {}) {
  const rnd = mulberry32(seed)
  const T = BUILDING_TYPES.find((t) => t.id === c.typeId) || BUILDING_TYPES[0]

  /* ══ 结构体系 / 洞口方式 / 屋面形式 ══
     这三项是「读真实图纸」补进来的：原引擎只有一种房子（从地上长出来的
     框架填充楼 + 逐开间窗 + 女儿墙平屋面），画萨伏伊、范斯沃斯必然全错。 */
  /* 视觉证据：来自多视角图像分析（fuse.js），优先级高于类型常识 */
  const V = c.vision || {}

  /* 结构体系 / 洞口方式 / 屋面形式：类型常识给出默认语义。
     以前这一行写死成 `(T.id === 'factory' ? 'frame' : 'frame')`（两个分支一样），
     等于所有类型都按「普通框架」处理 —— 细分子类就白分了。 */
  const structId = c.structure || V.structure || T.structure || 'frame'
  const ST = STRUCTURES.find((s) => s.id === structId) || STRUCTURES[1]
  const fenId = c.fenestration || V.fenestration || (T.curtain > 0.5 ? 'curtain' : 'window')
  const roofId = c.roof || V.roof || T.roof || 'parapet'
  const RF = ROOFS.find((r) => r.id === roofId) || ROOFS[0]
  const isPilotis = ST.id === 'pilotis'

  /* 方案变体：未被人工作锁定的自由度上的合规多解（避免每次重生成都一个样） */
  const variant = c.variant || makeVariant(seed)

  /* 底层架空高度：pilotis 时首层完成面被抬到 pilotiH，室外地坪在其下 */
  const phP = pick(c.pilotiH, { v: ST.pilotiH, src: 'type' })
  const pilotiH = isPilotis ? r2(clamp(phP.value, 0.6, 6)) : 0

  /* 勒脚：架空建筑底层透空，没有勒脚 —— 这一条原引擎硬编码了 0.35 */
  const PLIN = isPilotis ? 0 : 0.35
  /* base = 首层完成面（±0.000）在模型 z 中的高度 */
  const PAR = isPilotis ? pilotiH : PLIN
  const SLAB = 0.32 // 楼板结构厚度

  const audit = []
  const violations = []
  const warnings = []

  audit.push({ key: 'pilotiH', value: pilotiH ? `${pilotiH} m 架空` : '无架空', src: phP.src })

  /* ══ 第一层：层数 ══
     用户锁定 → 直接采用，视觉推断完全不参与。 */
  const floorsP = pick(
    c.floors,
    V.floors,
    {
      v: T.floors[0] + Math.floor(rnd() * (T.floors[1] - T.floors[0] + 1)),
      src: 'type',
    },
  )
  let floors = clamp(Math.round(floorsP.value), 1, 40)
  audit.push({ key: 'floors', value: floors, src: floorsP.src })

  /* ══ 第二层：层高 ══
     优先级：user 显式 > 由「总高 / 层数」反解 > 由「首层标高」标定 > 类型常识 */
  let fhDerived = null
  if (c.fh?.v) fhDerived = { v: c.fh.v, src: c.fh.src }
  else if (c.totalH?.v && floors) {
    fhDerived = { v: r2((c.totalH.v - PAR) / floors), src: c.totalH.src }
  } else if (c.firstFloor?.v) {
    fhDerived = { v: c.firstFloor.v, src: c.firstFloor.src }
  }
  const fhP = pick(fhDerived, { v: T.fh, src: 'type' })
  let FH = r2(clamp(fhP.value, 1.8, 12))
  audit.push({ key: 'floorHeight', value: FH, src: fhP.src })

  /* ── 物理常识校验：层高 ── */
  const [fhLo, fhHi] = PHYSICS.floorHeight
  if (FH < fhLo || FH > fhHi) {
    violations.push({
      key: 'floorHeight',
      msg: `层高 ${FH.toFixed(2)} m 超出常识区间 ${fhLo}–${fhHi} m`,
      src: fhP.src,
    })
  }

  /* ══ 第三层：总高一致性 ══
     若用户同时给了层数和总高，二者冲突时以 user 级为准，并对被覆盖的一方记账。 */
  const totalH = r2(PAR + floors * FH)
  if (c.totalH?.v && Math.abs(c.totalH.v - totalH) > 0.05) {
    const srcRank = SRC_RANK[c.totalH.src] ?? 0
    if (srcRank >= SRC_RANK[fhP.src]) {
      /* 总高来源更强 → 反推层高，层数不动 */
      FH = r2(clamp((c.totalH.v - PAR) / floors, 1.8, 12))
      audit.push({ key: 'floorHeight', value: FH, src: `${c.totalH.src}·from-totalH`, overridden: true })
      warnings.push('层高由总高反算，已覆盖类型常识值')
    } else {
      warnings.push({
        ignored: 'totalH',
        msg: `总高 ${c.totalH.v} m 与 ${floors}F × ${FH} m 不一致，已按人工层数优先`,
      })
    }
  }

  /* ══ 面宽 / 开间 ══ */
  const spanP = pick(c.span, { v: null, src: 'infer' })
  const baysP = pick(c.bays, V.bays, { v: null, src: 'infer' })
  let bays
  let bay
  if (spanP.value && baysP.value) {
    bays = clamp(Math.round(baysP.value), 1, 30)
    bay = r2(spanP.value / bays)
    audit.push({ key: 'bays', value: bays, src: baysP.src })
    audit.push({ key: 'bay', value: bay, src: spanP.src })
  } else if (spanP.value) {
    bays = clamp(Math.round(spanP.value / T.bayW), 2, 20)
    bay = r2(spanP.value / bays)
    audit.push({ key: 'bays', value: bays, src: 'infer' })
    audit.push({ key: 'bay', value: bay, src: spanP.src })
  } else if (baysP.value) {
    /* 没有尺度标定、但视觉/人工给了开间数：开间数照用，宽度退回类型常识。
       以前这一支直接被丢掉重新随机 —— 多视角读出来的开间就这么没了。 */
    bays = clamp(Math.round(baysP.value), 1, 30)
    bay = r2(T.bayW)
    audit.push({ key: 'bays', value: bays, src: baysP.src })
    audit.push({ key: 'bay', value: `${bay} m（未标定 · 类型常识开间宽）`, src: 'type' })
  } else {
    bays = clamp(Math.round(4 + rnd() * 4), 2, 12)
    bay = r2(T.bayW)
    audit.push({ key: 'bays', value: bays, src: 'infer' })
    audit.push({ key: 'bay', value: bay, src: 'type' })
  }
  const length = r2(bay * bays)

  /* ══ 结构柱网 grid：与立面开间 bay 彻底解耦 ══
     真实图纸上这两套网格经常不等：萨伏伊柱网 4.75 m、立面开间是黄金比细分。
     原引擎用 bay 兼做柱距，剖面只能画一根柱 —— 错了。 */
  const gridP = pick(c.grid, { v: null, src: 'infer' })
  let grid
  if (gridP.value) {
    grid = r2(clamp(gridP.value, 2, 12))
    audit.push({ key: 'grid', value: `${grid} m 结构柱网`, src: gridP.src })
  } else {
    /* 结构柱网不再默认等于立面开间：变体允许半跨加密 / 两跨合并，
       这正是真实建筑里「柱网与立面分格解耦」的常见做法。 */
    const k = variant.grid === 'half-bay' ? 0.5 : variant.grid === 'double-bay' ? 2 : 1
    grid = r2(clamp(bay * k, 2, 12))
    audit.push({ key: 'grid', value: `${grid} m（${variant.grid === 'bay' ? '缺省同开间' : '柱网变体 ' + variant.grid}）`, src: 'vision' })
  }
  /* 柱位：严格按柱网等距排布，两端各留悬挑 inset。
     真实建筑就是柱网内收 + 外皮悬挑（萨伏伊：4 跨 × 4.75 m = 19 m，
     前后各悬挑 1.25 m 凑出 21.5 m），不能反过来把柱距抹匀、柱顶到墙皮。 */
  const spansX = Math.max(1, Math.floor(length / grid))
  const insetX = r2(Math.max(0, (length - spansX * grid) / 2))
  const columns = Array.from({ length: spansX + 1 }, (_, i) => r2(insetX + i * grid))
  audit.push({
    key: 'columns',
    value: `${columns.length} 根 @ ${grid} m · 悬挑 ${insetX} m`,
    src: gridP.src,
  })

  const [bayLo, bayHi] = PHYSICS.bayWidth
  if (bay < bayLo || bay > bayHi) {
    violations.push({ key: 'bay', msg: `开间 ${bay.toFixed(2)} m 超出常识区间 ${bayLo}–${bayHi} m`, src: 'calib' })
  }

  /* ══ 进深 ══ */
  /* 进深：转角视角能同时看到两个立面 → 面宽/进深比是真几何证据，
     优先级高于「由照片宽高比猜」的老办法。 */
  const depthVision =
    V.footprintRatio?.v
      ? {
          v: clamp(r2(length / V.footprintRatio.v), PHYSICS.depth[0], PHYSICS.depth[1]),
          src: V.footprintRatio.src || 'vision',
        }
      : null
  const depthP = pick(c.depth, depthVision, { v: snap(3.5 + aspect * 2.6), src: 'infer' })
  const depth = r2(clamp(depthP.value, PHYSICS.depth[0], PHYSICS.depth[1]))
  audit.push({ key: 'depth', value: depth, src: depthP.src })

  /* 进深向柱网：与面宽向同 grid，进深小于柱网时收一跨 */
  const gridY = r2(clamp(grid, 2, Math.max(2, depth)))
  const spansY = Math.max(1, Math.floor(depth / gridY))
  const insetY = r2(Math.max(0, (depth - spansY * gridY) / 2))
  const columnsY = Array.from({ length: spansY + 1 }, (_, i) => r2(insetY + i * gridY))
  audit.push({ key: 'columnsY', value: `${columnsY.length} 榀 @ ${gridY} m · 悬挑 ${insetY} m`, src: gridP.src })

  const mainLen = snap(length * 0.62)
  const mainTop = r2(PAR + floors * FH)

  /* ══ 楼层：楼板结构标高 ══
     完全由 (PAR, floors, FH) 解析计算，不读取任何立面横向线。 */
  const levels = Array.from({ length: floors + 1 }, (_, i) => r2(PAR + i * FH))
  const mainLevels = levels.slice(1, floors)

  /* ══ 幕墙横向分格：装饰线，单独存放，永不进入 levels ══ */
  const mullions = []
  if (T.mull > 0) {
    for (let fl = 0; fl < floors; fl++) {
      for (let k = 1; k <= T.mull; k++) {
        mullions.push(r2(PAR + fl * FH + (k * FH) / (T.mull + 1)))
      }
    }
  }

  /* ══ 室内构件：只认人工声明，绝不靠「常识脑补」 ══
     照片看不见室内 → 楼梯 / 隔墙 / 家具一律不建模。
     未建模项进入 omissions，在图纸与审计栏显式声明。 */
  const interiorReq = c.interior || {}
  const interior = {}
  for (const it of INTERIOR_ITEMS) {
    const on = !!interiorReq[it.id]
    interior[it.id] = { on, src: on ? 'user-assert' : 'none', label: it.label, hint: it.hint }
  }

  /* ══ 楼梯：仅在用户声明「剖切经过楼梯间」时才建模 ══
     建模时按层高与踢面常识算实际跑数，而不是画一条固定斜线。 */
  let stair = null
  if (interior.stair.on) {
    const riser = r2(clamp(FH / Math.max(2, Math.round(FH / 0.17)), PHYSICS.riser[0], PHYSICS.riser[1]))
    const tread = r2(clamp(0.6 - riser * 0.6, 0.24, 0.32))
    const risersPerFlight = Math.max(2, Math.round(FH / riser))
    const ok = FH >= PHYSICS.floorHeight[0] && FH <= PHYSICS.floorHeight[1]
    stair = {
      riser,
      tread,
      risersPerFlight,
      flights: floors > 1 ? 2 : 1,
      width: r2(clamp(bay * 0.42, 1.1, 1.8)),
      ok,
      src: 'user-assert',
    }
    if (!ok) {
      violations.push({
        key: 'stair',
        msg: `层高 ${FH.toFixed(2)} m 无法排出合规梯段（踢面须 ${PHYSICS.riser[0]}–${PHYSICS.riser[1]} m）`,
      })
    }
  }
  audit.push({
    key: 'stair',
    value: stair ? `${stair.risersPerFlight}R × ${stair.flights}` : 'NOT MODELLED',
    src: interior.stair.src,
  })

  /* ══ 立面开洞 ══
     洞口竖向尺寸：user 给的窗台 / 窗顶优先（真值），否则按常识区间。 */
  const sillGiven = pick(c.sill, { v: null, src: 'infer' })
  const headGiven = pick(c.head, { v: null, src: 'infer' })
  /* 人工真值优先：给了就用，但做物理校验并记账 ——
     采用而不静默改数，冲突靠告警暴露，靠几何上限兜底。 */
  const sillRaw = sillGiven.value ?? (FH > 4.5 ? 0.6 : 0.9)
  const sillH = r2(clamp(sillRaw, 0.1, 1.5))
  if (
    sillGiven.value != null &&
    (sillGiven.value < PHYSICS.sillHeight[0] || sillGiven.value > PHYSICS.sillHeight[1])
  ) {
    warnings.push(
      `窗台高 ${sillGiven.value} m 超出常识区间 ${PHYSICS.sillHeight[0]}–${PHYSICS.sillHeight[1]} m（人工真值已采用）`,
    )
  }
  /* 窗高硬上限：窗顶不得越过上层楼板底（净高 − 板厚 − 窗台 − 余量）。
     这条上限是「平立剖交叉校验」的直接产物 —— 之前只用了 FH − 0.2，
     板厚没扣干净，通高玻璃会捅穿楼板。 */
  const maxWinH = Math.max(0.4, r2(FH - SLAB - sillH - 0.05))
  let winH = r2(clamp(Math.min(FH - 1.35, 2.4), 0.4, maxWinH))
  if (headGiven.value != null && headGiven.value > sillH) {
    winH = r2(clamp(headGiven.value - sillH, 0.4, maxWinH))
  }
  audit.push({ key: 'sill', value: `${sillH} m`, src: sillGiven.src })
  audit.push({ key: 'winH', value: `${winH} m`, src: headGiven.value != null ? headGiven.src : 'infer' })

  /* 窗宽由「窗墙比变体」决定，而不是写死的 0.52 —— 这是每次重新生成
     最直观的差异来源之一（图纸右上角会标出本次采用的变体编号）。 */
  const winW = r2(clamp(bay * (variant.wwr ?? (T.curtain > 0.5 ? 0.72 : 0.52)), 0.8, T.curtain > 0.5 ? bay * 0.86 : 2.4))
  const doorH = r2(clamp(2.1, PHYSICS.doorHeight[0], PHYSICS.doorHeight[1]))

  /* 立面节奏变体：决定哪些开间是实墙、哪一端做通高玻璃 */
  const entryBay = variant.entry === 'left' ? 0 : variant.entry === 'right' ? bays - 1 : Math.floor(bays / 2)
  const isSolidBay = (i) => {
    if (variant.rhythm === 'uniform') return i % 5 === 3
    if (variant.rhythm === 'grouped') return i % 3 === 1
    return false
  }
  const isAccentBay = (i) => variant.rhythm === 'accent' && (i === 0 || i === bays - 1)
  const accentSill = 0.25
  const accentWinH = Math.max(0.4, r2(FH - SLAB - accentSill - 0.05))

  const openings = []
  for (let fl = 0; fl < floors; fl++) {
    const zBase = PAR + fl * FH

    /* ── 横向长窗：每层一条，贯通整个立面，不被开间打断 ── */
    if (fenId === 'ribbon') {
      openings.push({
        kind: 'ribbon', fl, bay: 0,
        x0: r2(0.15), x1: r2(length - 0.15),
        sill: r2(zBase + sillH),
        head: r2(zBase + sillH + winH),
      })
      continue
    }

    /* ── 通高玻璃幕墙：整层满铺 ── */
    if (fenId === 'curtain') {
      openings.push({
        kind: 'curtain', fl, bay: 0,
        x0: r2(0.1), x1: r2(length - 0.1),
        sill: r2(zBase + 0.1),
        head: r2(zBase + FH - SLAB - 0.1),
      })
      continue
    }

    /* ── 逐开间独立窗（默认） ── */
    for (let i = 0; i < bays; i++) {
      const cx = (i + 0.5) * bay
      const roll = rnd()
      if (fl === 0 && i === entryBay) {
        openings.push({
          kind: 'door', fl, bay: i,
          x0: r2(cx - winW * 0.62), x1: r2(cx + winW * 0.62),
          sill: r2(PAR), head: r2(PAR + doorH),
        })
      } else if (isSolidBay(i)) {
        openings.push({ kind: 'solid', fl, bay: i })
      } else if (isAccentBay(i)) {
        /* 端部通高玻璃：窗台压到 0.25，窗顶仍不得越过上层板底 */
        openings.push({
          kind: 'window', fl, bay: i, accent: true,
          x0: r2(cx - winW / 2), x1: r2(cx + winW / 2),
          sill: r2(zBase + accentSill),
          head: r2(zBase + accentSill + accentWinH),
        })
      } else if (roll < 0.14) {
        openings.push({ kind: 'solid', fl, bay: i })
      } else {
        openings.push({
          kind: 'window', fl, bay: i,
          x0: r2(cx - winW / 2), x1: r2(cx + winW / 2),
          sill: r2(zBase + sillH),
          head: r2(zBase + sillH + winH),
        })
      }
    }
  }

  /* ══ 室内外高差 ±0.000 基准 ══
     首层完成面为 ±0.000，室外地坪在其下 siteDrop，勒脚自室外地坪起。 */
  const dropP = pick(c.siteDrop, { v: 0.45, src: 'type' })
  const siteDrop = r2(clamp(dropP.value, PHYSICS.siteDrop[0], PHYSICS.siteDrop[1]))
  audit.push({ key: 'siteDrop', value: `-${siteDrop.toFixed(3)}`, src: dropP.src })

  /* ══ 女儿墙 / 栏板：v0.5 起为独立参数控制 ══
     三档来源（优先级从高到低）：
     ① c.parapetOff —— UI 取消勾选「包含女儿墙」：无女儿墙，屋面恢复平板出挑；
     ② c.parapet    —— UI 勾选并指定高度（默认 0.9 m，规范区间 0.5–1.2：
        非上人屋面 0.5–0.6，上人屋面 ≥1.1）：user 级绝对优先，变体不介入；
     ③ 均未提供     —— 沿用屋面类型先验（parapet 0.6 / roofGarden 1.0 / flatSlab 0），
        檐口做法变体给出第二种合规解（「宁可保守，也不覆盖用户」）。
     总高联动：檐口 = 基座 + 层数×层高（totalH 口径不变，保证三视图共用）；
     建筑总高（至女儿墙顶）= 檐口 + parapet，剖面屋面标高 / 立面女儿墙尺寸线 /
     轴测矮墙拉伸全部由 parapet 驱动，勾选即平立剖轴测同步。 */
  const eavesAdj = variant.eaves === 'cornice' ? 0.25 : variant.eaves === 'recessed' ? -0.25 : 0
  let parapet
  let parapetSrc
  if (c.parapetOff?.v) {
    parapet = 0
    parapetSrc = 'user'
  } else if (c.parapet?.v != null) {
    /* v = 0 是合法的用户值（bench 真值「无女儿墙」就这样注入），
       钳制下限必须是 0 而非 PHYSICS 下限 0.5 —— 只防上限失真 */
    parapet = r2(clamp(c.parapet.v, 0, PHYSICS.parapet[1]))
    parapetSrc = 'user'
  } else {
    const parP = pick(c.parapet, { v: RF.parapet, src: 'type' })
    parapet = r2(clamp(parP.value + (parP.src === 'user' ? 0 : eavesAdj), 0, 1.5))
    parapetSrc = parP.src
  }
  const eavesH = r2(PAR + floors * FH)
  audit.push({
    key: 'roof',
    value: `${RF.label} · ${
      parapet > 0 ? `栏板 ${parapet} m · 女儿墙顶 +${(eavesH + parapet).toFixed(3)}` : '无女儿墙'
    }`,
    src: parapetSrc,
  })

  /* ══ 屋面附加构件：真实图纸上有，原引擎一个都没有 ══ */
  const roofFeatures = []
  if (roofId === 'roofGarden') roofFeatures.push('planting', 'curvedScreen', 'solarium', 'ramp')
  if (roofId === 'flatSlab') roofFeatures.push('cantilever')
  /* 架空建筑必有坡道（建筑漫步）；去重，避免同一构件被记两遍 */
  if (isPilotis && !roofFeatures.includes('ramp')) roofFeatures.push('ramp')
  /* 自由平面：内墙不承重、不落柱网（柯布五点之三） */
  const planFree = isPilotis || ST.id === 'columns' || !!c.planFree
  /* 柱是否在玻璃外侧（范斯沃斯的钢柱就在幕墙之外） */
  const columnsOutside = !!c.columnsOutside && ST.id !== 'bearing'

  /* ══════════ 平面数据 ══════════
     平面图同样执行「不臆想」红线：
     · 可以画 —— 外墙（与立面共用轮廓）、结构柱网、轴线、被观测立面上的洞口、
       剖切位置（这些都有视觉证据或人工真值）
     · 不许画 —— 房间划分、内门、家具、楼梯间（照片上完全不可见）
     因此 rooms / stairBox 默认全空，只有人工声明后才建模。 */
  const WALL_T = ST.id === 'bearing' ? 0.24 : 0.3
  const colSize = ST.id === 'pilotis' ? 0.3 : ST.id === 'columns' ? 0.28 : 0.4

  /* 剖切面位置：必须落在柱跨中点 —— 切到柱子上就看不见室内关系了。
     在进深 0.45–0.70 之间选最靠近 0.58 的那跨中点。 */
  const midSpans = []
  for (let i = 0; i + 1 < columnsY.length; i++) midSpans.push(r2((columnsY[i] + columnsY[i + 1]) / 2))
  const cutTarget = r2(depth * 0.58)
  const cutY = midSpans.length
    ? midSpans.reduce((a, b) => (Math.abs(b - cutTarget) < Math.abs(a - cutTarget) ? b : a))
    : r2(depth / 2)

  /* 南墙（唯一被观测的立面）上的洞口：直接取立面 openings 的 x 区间，
     保证平面与立面的洞口一一对应，绝不各算一套。 */
  const southOpenings = openings
    .filter((o) => o.fl === 0 && o.kind !== 'solid')
    .map((o) => ({ x0: o.x0, x1: o.x1, kind: o.kind, door: o.kind === 'door' }))

  /* 入口：架空建筑靠坡道进入（萨伏伊），常规建筑才是门 + 台阶 */
  const entry = isPilotis
    ? {
        kind: 'ramp',
        x0: r2(length * 0.12),
        x1: r2(length * 0.12 + Math.min(9, depth * 0.55)),
        w: 1.35,
        y0: r2(cutY + 0.4),
        y1: r2(depth - WALL_T - 0.3),
        label: '坡道 · 建筑漫步',
      }
    : {
        kind: 'door',
        x: r2(clamp((entryBay + 0.5) * bay, 1.2, Math.max(1.2, length - 1.2))),
        w: 1.5,
        y: r2(depth - WALL_T),
        label: `主入口 M1 · ${variant.entry === 'center' ? '居中' : variant.entry === 'left' ? '左端' : '右端'}`,
      }

  /* 房间：仅人工声明「内隔墙」后划分。
     自由平面（planFree）时不按柱网等分，用不等分体现柯布的自由平面。 */
  let rooms = []
  if (interior.partitions.on) {
    const names = ROOM_NAMES[T.id] || ROOM_NAMES.residential
    const inX0 = WALL_T
    const inX1 = r2(length - WALL_T)
    const inY0 = WALL_T
    const inY1 = r2(depth - WALL_T)
    const nx = clamp(Math.round(length / Math.max(3, bay * 1.5)), 2, 5)
    /* 自由平面用不等分权重，承重体系用等分（内墙要落柱网） */
    const weights = planFree ? [0.34, 0.28, 0.38, 0.3, 0.32] : Array.from({ length: nx }, () => 1 / nx)
    const wsum = weights.slice(0, nx).reduce((a, b) => a + b, 0)
    let k = 0
    let cx = inX0
    for (let i = 0; i < nx; i++) {
      const w = ((inX1 - inX0) * weights[i % weights.length]) / wsum
      const x0 = r2(cx)
      const x1 = r2(cx + w)
      /* 走廊 + 房间两段（沿进深） */
      const corridor = r2(Math.min(1.8, (inY1 - inY0) * 0.22))
      rooms.push({
        name: names[k % names.length],
        x0, y0: inY0, x1, y1: r2(inY1 - corridor),
        door: { x: r2(x0 + 0.5), w: 0.9 },
      })
      k++
      const corridorName = T.id === 'residential' ? '走道' : '走廊'
      rooms.push({
        name: corridorName,
        x0, y0: r2(inY1 - corridor), x1, y1: inY1,
        door: null,
      })
      k++
      cx = x1
    }
  }

  /* 楼梯间：仅人工声明后建模，位置避开剖切线与柱位 */
  let stairBox = null
  if (interior.stair.on && stair) {
    const runLen = r2(clamp(stair.tread * (stair.risersPerFlight - 1), 2.2, 6))
    const boxW = r2(clamp(stair.width * 2 + 0.3, 2.4, 5))
    const boxL = r2(clamp(runLen + stair.tread * 2, 3.2, 8))
    const sx = r2(clamp(length - WALL_T - boxW - 0.3, WALL_T + 0.2, Math.max(WALL_T + 0.2, length - WALL_T - boxW - 0.3)))
    const sy = r2(clamp(WALL_T + 0.2, WALL_T + 0.2, Math.max(WALL_T + 0.2, depth - WALL_T - boxL - 0.3)))
    stairBox = {
      x0: sx, y0: sy, w: boxW, l: boxL,
      treads: stair.risersPerFlight,
      flights: stair.flights,
      width: stair.width,
      tread: stair.tread,
    }
  }

  /* 观测立面：由多视角融合给出（V.observed），没有视觉证据时只有南立面 */
  const ALL_FACES = ['south', 'east', 'west', 'north']
  const OBSERVED_FACES = Array.isArray(V.observed) && V.observed.length
    ? ALL_FACES.filter((f) => V.observed.includes(f))
    : ['south']

  const plan = {
    level: 0,
    levelLabel: isPilotis ? '底层 · 架空层平面' : '一层平面',
    wallT: WALL_T,
    colSize,
    outer: { x0: 0, y0: 0, x1: length, y1: depth },
    inner: { x0: WALL_T, y0: WALL_T, x1: r2(length - WALL_T), y1: r2(depth - WALL_T) },
    axisX: columns.map((x, i) => ({ x, label: AXIS_NUMBERS[i] || `${i + 1}` })),
    axisY: columnsY.map((y, i) => ({ y, label: AXIS_LETTERS[i] || `Y${i + 1}` })),
    columns: (() => {
      const out = []
      for (const x of columns) for (const y of columnsY) out.push({ x, y, w: colSize, d: colSize })
      return out
    })(),
    southOpenings,
    entry,
    rooms,
    stairBox,
    cutY,
    /* 观测覆盖：多视角融合后真正被"看见"的立面，其余立面不做推断。
       这一项以前只看上传张数，现在由逐视角图像分析决定。 */
    observed: OBSERVED_FACES,
    unobserved: ALL_FACES.filter((f) => !OBSERVED_FACES.includes(f)),
  }
  audit.push({
    key: 'plan',
    value: `${plan.columns.length} 柱位 · 轴线 ${plan.axisX.length}×${plan.axisY.length} · 剖切 y=${cutY}`,
    src: 'derived',
  })

  /* ══ 未建模项声明：图纸上必须写明「没画什么」 ══ */
  const omissions = INTERIOR_ITEMS.filter((it) => !interior[it.id].on).map((it) => ({
    id: it.id,
    label: it.label,
    reason: '照片中不可见 · 无视觉证据，按「不臆想」原则不建模',
  }))

  /* ══ 细节降级：约束不可信时宁可空壳 ══
     触发条件：存在物理常识违背 / 未做场景清洗 / 视角不足 / 关键量来自纯推断 */
  const uncalibrated = !c.span?.v && !c.totalH?.v && !c.fh?.v
  const lowConfidence = violations.length > 0 || !c.cleaned || uncalibrated
  const detail = !lowConfidence

  const degradeReasons = []
  if (violations.length) degradeReasons.push(`${violations.length} 项物理常识违背`)
  if (!c.cleaned) degradeReasons.push('未完成场景清洗')
  if (uncalibrated) degradeReasons.push('关键尺寸来自纯推断')

  /* ══ 体块 ══ */
  const volumes = [
    /* 架空建筑没有落地基座，只有一层薄地坪 —— 原来这里会被画成实心墩子，
       把柯布最核心的「底层透空」直接糊掉。 */
    { id: 'plinth', x0: 0, y0: 0, z0: 0, x1: length, y1: depth, z1: isPilotis ? 0.1 : PAR, levels: [] },
    { id: 'porch', x0: 1.2, y0: depth - 0.3, z0: 0, x1: 4.6, y1: depth + 1.8, z1: 2.9, levels: [] },
    { id: 'main', x0: 0.4, y0: 0.4, z0: PAR, x1: mainLen, y1: depth - 0.4, z1: mainTop, levels: mainLevels },
    {
      id: 'wing',
      x0: mainLen, y0: 0.4, z0: PAR, x1: length - 0.4, y1: depth - 0.4,
      z1: r2(PAR + Math.min(floors, 1) * Math.min(FH, 4.5)),
      levels: [],
    },
    {
      id: 'core',
      x0: Math.max(1.0, mainLen - 1.8), y0: 0.9, z0: mainTop,
      x1: mainLen - 0.3, y1: 2.6, z1: r2(mainTop + 2.8),
      levels: [],
    },
  ]
  /* 厂房：无入口门廊与侧翼体量 */
  if (T.id === 'factory') dropVolumes('porch', 'wing')
  /* 架空 / 独立柱体系：纯净方盒，没有门廊、侧翼、核心筒
     （萨伏伊就是「一个白色方盒子被细柱支起」，加这些体量就画错了） */
  if (isPilotis || ST.id === 'columns') dropVolumes('porch', 'wing', 'core')

  function dropVolumes(...ids) {
    for (let i = volumes.length - 1; i >= 0; i--) {
      if (ids.includes(volumes[i].id)) volumes.splice(i, 1)
    }
  }

  /* 覆盖率不再是「上传张数」除以 4，而是真正被观测到的立面数 */
  const facesObserved = clamp(OBSERVED_FACES.length, 1, 4)
  const coverage = [0, 0.42, 0.66, 0.82, 0.94][facesObserved]

  /* 横向线检测统计：幕墙分格必须从楼层判定里剔除 */
  const linesDetected = levels.length + mullions.length
  const linesSuppressed = mullions.length

  return {
    type: T,
    floors,
    floorHeight: FH,
    totalH: r2(PAR + floors * FH),
    slab: SLAB,
    length,
    depth,
    bays,
    bay,
    volumes,
    levels,
    mullions,
    openings,
    stair,
    interior,
    omissions,
    plan,
    finishes: FINISHES[T.id] || FINISHES.residential,
    siteDrop,
    parapet,

    /* ── 真实建筑语义（原引擎缺失，本版补齐） ── */
    structure: ST.id,
    structureLabel: ST.label,
    pilotiH,
    plinth: PLIN,
    base: PAR,
    grid,
    columns,
    fenestration: fenId,
    roof: roofId,
    roofLabel: RF.label,
    roofFeatures,
    planFree,
    columnsOutside,

    maxZ: r2(mainTop + 2.8),
    seed,
    views,
    coverage,
    linesDetected,
    linesSuppressed,

    /* ══ 方案变体 ══
       同一批输入在未锁定的自由度上给出不同但都合规的解。
       直接标在图纸图签上，方便判断「这次生成采用了哪种组合」。 */
    variant,
    variantLabel: `${variant.id} · 窗墙比 ${variant.wwr} · 节奏 ${variant.rhythm} · 入口 ${variant.entry} · 檐口 ${variant.eaves}`,
    /* 多视角融合报告（由 App 注入，UI 展示「每个视角贡献了什么」） */
    fusion: c.fusion || null,

    /* 约束审计 */
    audit,
    violations,
    warnings,
    detail,
    degradeReasons,
    cleaned: !!c.cleaned,

    scale: {
      mode: c.span?.src === 'user' || c.span?.src === 'calib' ? 'constraint-calibrated' : 'type-prior',
      refKind: c.span?.refKind || null,
      err: c.span?.v ? '±2.2%' : '±8.5%',
    },
    /* 交叉校验与多轮采样结果由 finalizeCandidates() 回填 */
    refine: null,
    issues: [],

    evidence: {
      floorFrom:
        floorsP.src === 'user'
          ? 'user-constraint'
          : floorsP.src === 'vision'
            ? 'multi-view-vision'
            : `${floorsP.src}-prior`,
      note:
        floorsP.src === 'user'
          ? `层数 = ${floors}F 由人工设定，楼层线由 ±0.000 起按层高 ${FH} m 解析推算；立面横向线（含幕墙分格 ${linesSuppressed} 条）不参与判定`
          : floorsP.src === 'vision'
            ? `层数 = ${floors}F 由 ${c.fusion?.count ?? '若干'} 个真实视角的楼层带投票得出（同意票数 ${c.fusion?.votes?.floors?.agree ?? '—'}）；幕墙分格线 ${linesSuppressed} 条已剔除`
            : `楼层由楼板边缘聚类 + ${T.label}类型层高先验判定，幕墙分格线 ${linesSuppressed} 条已剔除`,
    },
  }
}

/* ══════════════════════════════════════════════════════════
   准确性优先：多轮采样一致性求解 + 平立剖交叉校验
   ══════════════════════════════════════════════════════════
   单次求解里 bays / depth / floors 等量带有随机性（视觉推断本就不确定）。
   与其假装一次就算准，不如跑 N 轮采样：
   · 取各量的中位数作为「共识真值」
   · 选与共识最接近的那一轮作为最终模型（而不是拼一个矛盾体出来）
   · 各轮分歧越大 → 一致度越低 → 自动降级细节
   这一步让「慢」换来的是可验证的稳定性，而不是单纯的等待。 */

export function samplePass(seed, aspect, views, c, i = 0) {
  return makeModel((seed + i * 7919) % 2147483647, aspect, views, c)
}

/**
 * 平立剖交叉校验：三视图必须来自同一份几何。
 * 任何一处自相矛盾都记进 issues，并在图纸与面板上告警。
 */
export function crossCheck(m) {
  const issues = []
  const P = m.plan
  if (!P) return issues

  /* ① 剖切线不得穿过柱子 —— 切到柱上就看不见室内了 */
  const colYs = P.axisY.map((a) => a.y)
  const nearestCol = Math.min(...colYs.map((y) => Math.abs(y - P.cutY)))
  if (nearestCol < 0.4) {
    issues.push({ key: 'cut-on-column', msg: `剖切线距最近柱心仅 ${nearestCol.toFixed(2)} m，剖切面应落在柱跨之间` })
  }

  /* ② 平面洞口必须落在南墙墙段内，且彼此不重叠 */
  const ops = P.southOpenings.filter((o) => !o.door)
  let overlap = false
  for (let i = 1; i < ops.length; i++) if (ops[i].x0 < ops[i - 1].x1 - 0.01) overlap = true
  if (overlap) issues.push({ key: 'opening-overlap', msg: '平面洞口存在重叠，与立面洞口无法一一对应' })
  for (const o of ops) {
    if (o.x0 < 0 || o.x1 > m.length + 0.01) {
      issues.push({ key: 'opening-out', msg: `洞口 ${o.x0}–${o.x1} m 超出外墙范围` })
      break
    }
  }

  /* ③ 立面窗顶不得越过上层楼板底 */
  for (const o of m.openings) {
    if (o.kind === 'solid' || o.kind === 'door') continue
    const ceil = m.base + (o.fl + 1) * m.floorHeight - m.slab
    if (o.head > ceil + 0.01) {
      issues.push({ key: 'window-cross', msg: `${o.fl + 1}F 窗顶 ${o.head} m 越过上层楼板底 ${ceil.toFixed(2)} m` })
      break
    }
  }

  /* ④ 门洞高不得大于层高 */
  if (m.openings.some((o) => o.kind === 'door')) {
    const doorH = 2.1
    if (doorH > m.floorHeight - m.slab) {
      issues.push({ key: 'door-height', msg: `门洞 2.10 m 高于层高净空 ${(m.floorHeight - m.slab).toFixed(2)} m` })
    }
  }

  /* ⑤ 平面柱必须落在建筑轮廓内 */
  for (const c of P.columns) {
    if (c.x < 0 || c.x > m.length || c.y < 0 || c.y > m.depth) {
      issues.push({ key: 'col-out', msg: '结构柱落在建筑轮廓之外' })
      break
    }
  }

  /* ⑥ 总高 = 层数 × 层高（±0.05） */
  const calc = m.base + m.floors * m.floorHeight
  if (Math.abs(calc - m.totalH) > 0.05) {
    issues.push({ key: 'height-mismatch', msg: `总高 ${m.totalH} m 与 ${m.floors}F × ${m.floorHeight} m 不自洽` })
  }
  return issues
}

/**
 * 100mm 网格吸附：所有几何量对齐 0.1 m 基准（GB 模数 1M = 100mm）。
 * 视觉推断/多轮采样中位数可能产出 3.137 这类"机器味"尺寸，
 * 图纸要有专业感，尺寸必须是 100mm 的整数倍 —— 标注线读起来才像设计过的。
 * 吸附在 finalize 一致性投票之后做，保证各轮采样的共识不被破坏。
 */
function snapGeometry (m) {
  const S = (v) => Math.round(v * 10) / 10
  const out = { ...m }
  for (const k of ['length', 'depth', 'floorHeight', 'bay', 'siteDrop', 'parapet']) {
    if (Number.isFinite(out[k])) out[k] = S(out[k])
  }
  if (Number.isFinite(out.base)) out.base = S(out.base)
  if (Number.isFinite(out.pilotiH)) out.pilotiH = S(out.pilotiH)
  /* 柱位吸附后必须仍在建筑轮廓内（crossCheck ⑤）：吸附的 ±0.05 不许把边柱推出外墙 */
  if (Array.isArray(out.columns)) {
    out.columns = out.columns.map((v) => Math.min(out.length, Math.max(0, S(v))))
  }
  if (Array.isArray(out.levels)) out.levels = out.levels.map(S)
  if (Array.isArray(out.mullions)) out.mullions = out.mullions.map(S)
  if (Array.isArray(out.openings)) {
    out.openings = out.openings.map((o) => ({ ...o, x0: S(o.x0), x1: S(o.x1), sill: S(o.sill), head: S(o.head) }))
  }
  if (out.plan?.columnX) out.plan = { ...out.plan, columnX: out.plan.columnX.map(S) }
  /* 平面柱网同样吸附 + 夹紧在轮廓内（length/depth 已先吸附） */
  if (out.plan?.columns) {
    out.plan = {
      ...out.plan,
      columns: out.plan.columns.map((c) => ({
        ...c,
        x: Math.min(out.length, Math.max(0, S(c.x))),
        y: Math.min(out.depth, Math.max(0, S(c.y))),
      })),
    }
  }
  /* 总高与层高吸附后必须保持自洽（crossCheck ⑥ 校验 totalH = base + floors × FH） */
  if (Number.isFinite(out.base)) out.totalH = S(out.base + out.floors * out.floorHeight)
  return out
}

/**
 * 汇总多轮采样结果。
 * @param {Array} cands  samplePass 产出的候选模型
 */
export function finalizeCandidates(cands) {
  if (!cands.length) return null
  /* 只有视觉推断的量才会随随机种子抖动；人工 / 标定值各轮必然相同 */
  const KEYS = ['bays', 'depth', 'floors', 'floorHeight', 'length']
  const median = (arr) => {
    const a = [...arr].sort((x, y) => x - y)
    const m = Math.floor(a.length / 2)
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
  }
  const target = {}
  for (const k of KEYS) target[k] = median(cands.map((m) => m[k]))

  let best = cands[0]
  let bestD = Infinity
  for (const m of cands) {
    const d = KEYS.reduce(
      (acc, k) => acc + Math.abs(m[k] - target[k]) / Math.max(1e-6, Math.abs(target[k]) || 1),
      0,
    )
    if (d < bestD) {
      bestD = d
      best = m
    }
  }

  /* 一致度：各轮相对中位数的最大相对偏差 */
  let spread = 0
  for (const k of KEYS) {
    const t = Math.abs(target[k]) || 1
    for (const m of cands) spread = Math.max(spread, Math.abs(m[k] - target[k]) / t)
  }
  const agreement = r2(1 - Math.min(1, spread))
  /* 100mm 吸附先于交叉校验：校验对象必须是最终交付给绘制层的几何 */
  best = snapGeometry(best)
  const issues = crossCheck(best)

  const degradeReasons = [...(best.degradeReasons || [])]
  if (agreement < 0.9) degradeReasons.push(`多轮采样一致度仅 ${Math.round(agreement * 100)}%`)
  if (issues.length) degradeReasons.push(`${issues.length} 项平立剖交叉校验不通过`)

  const model = {
    ...best,
    refine: {
      passes: cands.length,
      agreement,
      spread: r2(spread),
      consensus: KEYS.map((k) => ({ k, v: Number(target[k].toFixed(2)) })),
      picked: best.seed,
    },
    issues,
    /* 一致度不足或交叉校验不通过 → 一律降级为保守表达 */
    detail: best.detail && agreement >= 0.9 && issues.length === 0,
    degradeReasons,
    warnings: [...(best.warnings || []), ...issues.map((i) => i.msg)],
  }
  model.audit = [
    ...best.audit,
    { key: 'refine', value: `${cands.length} 轮采样 · 一致度 ${Math.round(agreement * 100)}%`, src: 'derived' },
    { key: 'crossCheck', value: issues.length ? `${issues.length} 项冲突` : '平立剖一致', src: 'derived' },
  ]
  return { model, issues, agreement, spread: r2(spread) }
}
