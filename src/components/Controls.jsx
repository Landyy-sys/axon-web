import { BUILDING_TYPES, TYPE_GROUPS, FLOOR_HEIGHTS, PHYSICS, INTERIOR_ITEMS } from '../model.js'
import { PRESETS } from '../benchmarks.js'
import { GLOSSARY_MAP } from '../glossary.js'
import Term from './Term.jsx'

const SEL =
  'w-full rounded-md border border-hair bg-white px-2 py-1.5 text-[12px] text-ink outline-none transition-colors focus:border-ink'

const SRC_META = {
  user: { label: '人工', cls: 'bg-accent/15 text-accent border-accent/40' },
  calib: { label: '标定', cls: 'bg-[#eef2ff] text-[#4338ca] border-[#c7d2fe]' },
  type: { label: '类型', cls: 'bg-[#f1f0ec] text-muted border-hair' },
  infer: { label: '推断', cls: 'bg-[#f1f0ec] text-muted border-hair' },
}

function Badge({ src }) {
  const m = SRC_META[src] || SRC_META.infer
  return (
    <span className={`rounded border px-1 font-mono text-[9px] leading-[14px] ${m.cls}`}>
      {m.label}
    </span>
  )
}

/* audit 里出现的内部键名 → 名词表 id。能对上的就渲染成可解读的名词，
   对不上的原样输出（宁可不解读，也不张冠李戴）。 */
const AUDIT_KEY_TERM = {
  bay: 'bayWidth',
  fh: 'floorHeight',
  totalH: 'totalHeight',
  roof: 'parapet',
  structure: 'buildingType',
  pilotiH: 'pilotis',
  fenestration: 'curtainWall',
}
function AuditKey({ k }) {
  const id = AUDIT_KEY_TERM[k] || k
  const hit = GLOSSARY_MAP[id]
  return (
    <span className="text-muted">
      {hit ? (
        <Term id={id}>{k}</Term>
      ) : (
        k
      )}
    </span>
  )
}

/** 数值约束输入：勾选即升级为 user 级（人工设定绝对优先）
    label 支持传入术语 id，自动渲染带虚线解读的名词。 */
function NumField({ label, unit, hint, value, onSet, min, max, step = 0.1, range, term }) {
  const on = value != null
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="flex min-w-0 cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={on}
            onChange={(e) => onSet(e.target.checked ? (range ? range[0] : min ?? 0) : null)}
            className="h-3 w-3 accent-[#9a3412]"
          />
          <span className="text-[12.5px] text-ink">
            {term ? <Term id={term}>{label}</Term> : label}
          </span>
        </label>
        <div className="flex shrink-0 items-center gap-1">
          <input
            type="number"
            value={on ? value : ''}
            step={step}
            min={min}
            max={max}
            disabled={!on}
            placeholder="—"
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              onSet(Number.isNaN(v) ? null : v)
            }}
            className="w-[68px] rounded border border-hair bg-white px-1.5 py-1 text-right text-[12px] text-ink outline-none disabled:bg-[#f1f0ec] disabled:text-muted"
          />
          <span className="w-[14px] text-[11px] text-muted">{unit}</span>
        </div>
      </div>
      {hint && <p className="mt-0.5 pl-[21px] text-[11px] leading-snug text-muted">{hint}</p>}
    </div>
  )
}

export default function Controls({ c, onChange, disabled, calib, model }) {
  const T = BUILDING_TYPES.find((t) => t.id === c.typeId) || BUILDING_TYPES[0]
  const set = (k, v) => onChange({ ...c, [k]: v ? { v, src: 'user' } : { v: null, src: null } })
  const get = (k) => c[k]?.v ?? null

  return (
    <div className="mt-4 rounded-lg border border-hair bg-sheet/60 p-3.5">
      <div className="mb-1 flex items-center justify-between">
        <p className="font-mono text-[10.5px] tracking-wider text-muted">03 · CONSTRAINTS</p>
        {calib?.pxPerM && (
          <span className="font-mono text-[10.5px] text-accent">
            {calib.pxPerM.toFixed(1)} px/m
          </span>
        )}
      </div>

      <p className="mb-2 border-l-2 border-accent/50 pl-2 text-[11px] leading-snug text-muted">
        勾选即升级为<span className="text-accent">人工设定</span>，
        优先级高于一切视觉推断，算法无条件服从。
      </p>

      <div className="divide-y divide-[#e8e6e1]">
        {/* ══ 真实建筑原型：一键套用实测真值 ══ */}
        <div className="py-2">
          <p className="text-[12.5px] text-ink">建筑原型（真实建筑实测值）</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted">
            前三项取自真实建筑平/立/剖图纸的实测尺寸，用于对照检验出图是否正确。
          </p>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={disabled}
                onClick={() =>
                  onChange({
                    /* 原型给出结构 / 洞口 / 屋面语义与尺寸真值；
                       人工已有的层数 / 层高 / 面宽 / 清洗状态保留不动 */
                    ...c,
                    ...p.c,
                    typeId: c.typeId,
                    cleaned: c.cleaned,
                    interior: c.interior || { stair: false, partitions: false, furniture: false },
                  })
                }
                className="rounded-md border border-hair bg-white px-2 py-1.5 text-left transition-colors hover:border-ink disabled:opacity-50"
              >
                <span className="block text-[11.5px] text-ink">{p.label}</span>
                <span className="mt-0.5 block font-mono text-[9.5px] leading-snug text-muted">{p.note}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="py-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Term id="buildingType" className="text-[12.5px] text-ink">建筑类型</Term>
              <p className="mt-0.5 text-[11px] text-muted">
                默认层高 {T.fh} m · 常见开间 {T.bayW} m · 层数 {T.floors[0]}–{T.floors[1]}F
              </p>
            </div>
            <div className="w-[142px] shrink-0">
              <select
                value={c.typeId}
                disabled={disabled}
                onChange={(e) => onChange({ ...c, typeId: e.target.value })}
                className={SEL}
              >
                {TYPE_GROUPS.map((g) => (
                  <optgroup key={g.id} label={g.label}>
                    {BUILDING_TYPES.filter((t) => (t.group || 'public') === g.id).map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>
          {/* 大白话说明：网站面向大众，不能只丢一个专业名词 */}
          <p className="mt-1.5 border-l-2 border-ink/20 pl-2 text-[11px] leading-relaxed text-muted">
            {T.note}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {BUILDING_TYPES.filter((t) => (t.group || 'public') === (T.group || 'public'))
              .slice(0, 8)
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange({ ...c, typeId: t.id })}
                  className={[
                    'rounded border px-1.5 py-0.5 text-[10.5px] transition-colors',
                    t.id === c.typeId
                      ? 'border-ink bg-ink text-white'
                      : 'border-hair text-muted hover:border-ink hover:text-ink',
                  ].join(' ')}
                >
                  {t.label.replace(/ · /g, '·')}
                </button>
              ))}
          </div>
        </div>

        <div>
        <NumField
          label="层数"
          term="floors"
          unit="F"
          value={get('floors')}
            onSet={(v) => set('floors', v == null ? null : Math.round(v))}
            min={1}
            max={40}
            step={1}
            range={[T.floors[0], T.floors[1]]}
            hint={
              get('floors')
                ? '已锁定 — 楼层线由 ±0.000 起按层高解析推算，立面横向线（含幕墙分格）不参与判定'
                : `未锁定 — 按${T.label}类型常识推定 ${T.floors[0]}–${T.floors[1]}F`
            }
          />
          <div className="flex flex-wrap gap-1 pb-2 pl-[21px]">
            {[1, 2, 3, 4, 6, 8, 12, 20].map((n) => (
              <button
                key={n}
                disabled={disabled}
                onClick={() => set('floors', n)}
                className={[
                  'rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors',
                  get('floors') === n
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-hair text-muted hover:border-ink hover:text-ink',
                ].join(' ')}
              >
                {n}F
              </button>
            ))}
          </div>
        </div>

        <NumField
          label="层高"
          term="floorHeight"
          unit="m"
          value={get('fh')}
          onSet={(v) => set('fh', v)}
          min={1.8}
          max={12}
          range={PHYSICS.floorHeight}
          hint={`覆盖类型默认 ${T.fh} m · 常识区间 ${PHYSICS.floorHeight[0]}–${PHYSICS.floorHeight[1]} m（这是地板到地板的高度，还要减去楼板厚才是你能用的净高）`}
        />

        <NumField
          label="总高度"
          term="totalHeight"
          unit="m"
          value={get('totalH')}
          onSet={(v) => set('totalH', v)}
          min={2}
          max={200}
          range={[3, 100]}
          hint="±0.000 至檐口。与层数同时给定时，自动反算层高"
        />

        {/* ══ 女儿墙（Parapet）：独立参数控制（v0.5）══
            勾选 = 包含女儿墙；输入高度默认 0.9 m（规范 0.5–1.2 m）。
            联动：建筑总高（至女儿墙顶）= 层数 × 层高 + 女儿墙高度，
            平 / 立 / 剖 / 轴测四视图共用同一 parapet 值同步绘制。 */}
        <div className="py-2">
          <label className="flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={c.parapet?.v != null ? true : c.parapetOff?.v ? false : (model?.parapet ?? 0.6) > 0}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...c,
                  parapet: e.target.checked ? { v: c.parapet?.v ?? model?.parapet ?? 0.9, src: 'user' } : { v: null, src: null },
                  parapetOff: e.target.checked ? { v: null, src: null } : { v: true, src: 'user' },
                })
              }
              className="h-3 w-3 accent-[#9a3412]"
            />
            <span className="text-[12.5px] text-ink">包含女儿墙 (Parapet)</span>
          </label>
          <div className="mt-1 flex items-center gap-2 pl-[21px]">
            <span className="shrink-0 text-[11.5px] text-muted">女儿墙高度</span>
            <input
              type="number"
              value={c.parapet?.v ?? model?.parapet ?? 0.9}
              step={0.05}
              min={0.5}
              max={1.2}
              disabled={disabled || !!c.parapetOff?.v}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                if (!Number.isNaN(v))
                  onChange({ ...c, parapet: { v, src: 'user' }, parapetOff: { v: null, src: null } })
              }}
              className="w-[68px] rounded border border-hair bg-white px-1.5 py-1 text-right text-[12px] text-ink outline-none disabled:bg-[#f1f0ec] disabled:text-muted"
            />
            <span className="text-[11px] text-muted">m</span>
          </div>
          <p className="mt-0.5 pl-[21px] text-[11px] leading-snug text-muted">
            总高（至女儿墙顶）= 层数 × 层高 + 此值 · 平/立/剖/轴测同步 · 规范区间 0.5–1.2 m（非上人 0.5–0.6，上人屋面 ≥1.1）
          </p>
        </div>

        <NumField
          label="关键进深"
          term="depth"
          unit="m"
          value={get('depth')}
          onSet={(v) => set('depth', v)}
          min={PHYSICS.depth[0]}
          max={PHYSICS.depth[1]}
          range={[5, 15]}
          hint="剖面剖切方向的建筑进深（正面往里的厚度）"
        />

        <NumField
          label="面宽"
          term="span"
          unit="m"
          value={get('span')}
          onSet={(v) => set('span', v)}
          min={3}
          max={200}
          range={[10, 60]}
          hint="不填时按开间常识反推（面宽 = 开间数 × 单个开间宽）"
        />

        <NumField
          label="开间数"
          term="bays"
          unit="个"
          value={get('bays')}
          onSet={(v) => set('bays', v == null ? null : Math.round(v))}
          min={1}
          max={30}
          step={1}
          range={[3, 10]}
          hint="与面宽同时给定时，单个开间宽 = 面宽 ÷ 开间数"
        />

        <NumField
          label="室内外高差"
          term="siteDrop"
          unit="m"
          value={get('siteDrop')}
          onSet={(v) => set('siteDrop', v)}
          min={PHYSICS.siteDrop[0]}
          max={PHYSICS.siteDrop[1]}
          step={0.05}
          range={[0.3, 0.6]}
          hint="首层完成面 ±0.000 与室外地坪之差，默认 0.45"
        />

        {/* ══ 内部构件：照片里看不见，除非人工声明否则一律不建模 ══ */}
        <div className="py-2">
          <p className="text-[12.5px] text-ink">内部构件（需人工声明）</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted">
            照片只能看到外皮。楼梯 / 隔墙 / 家具属于不可见构件，
            <span className="text-accent">默认不建模</span>；只有当你确认剖切面确实经过它们时才勾选。
          </p>
          <div className="mt-1.5 space-y-1">
            {INTERIOR_ITEMS.map((it) => {
              const on = !!c.interior?.[it.id]
              return (
                <label key={it.id} className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={disabled}
                    onChange={(e) => onChange({ ...c, interior: { ...c.interior, [it.id]: e.target.checked } })}
                    className="mt-[3px] h-3 w-3 accent-[#9a3412]"
                  />
                  <span className="min-w-0">
                    <span className="text-[12px] text-ink">{it.label}</span>
                    <span className="ml-1.5 font-mono text-[9.5px] text-muted">{it.hint}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 py-1.5">
          <div className="min-w-0">
            <p className="text-[12.5px] text-ink">层高取值</p>
            <p className="mt-0.5 text-[11px] text-muted">常用模数快速填入</p>
          </div>
          <div className="w-[132px] shrink-0">
            <select
              value=""
              disabled={disabled}
              onChange={(e) => e.target.value && set('fh', parseFloat(e.target.value))}
              className={SEL}
            >
              <option value="">选择…</option>
              {FLOOR_HEIGHTS.map((h) => (
                <option key={h} value={h}>{h.toFixed(1)} m</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── 求解结果与校验 ── */}
      {model && (
        <div className="mt-3 border-t border-hair pt-2.5">
          <p className="mb-1.5 font-mono text-[10px] tracking-wider text-muted">
            SOLVED · 求解结果（点名词看解释）
          </p>
          <div className="space-y-1">
            {model.audit.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-2 font-mono text-[10.5px]">
                <AuditKey k={a.key} />
                <span className="flex items-center gap-1.5">
                  {a.overridden && <span className="text-accent">覆盖</span>}
                  <span className="text-ink">{a.value}</span>
                  <Badge src={a.src} />
                </span>
              </div>
            ))}
          </div>

          {model.violations.length > 0 && (
            <div className="mt-2 rounded border border-[#b91c1c]/40 bg-[#fef2f2] p-2">
              <p className="font-mono text-[10px] tracking-wider text-[#b91c1c]">
                PHYSICS VIOLATION · {model.violations.length}
              </p>
              {model.violations.map((v, i) => (
                <p key={i} className="mt-0.5 text-[11px] leading-snug text-[#7f1d1d]">
                  · {v.msg}
                </p>
              ))}
            </div>
          )}

          {model.degradeReasons.length > 0 && (
            <p className="mt-2 text-[11px] leading-snug text-accent">
              已降级为保守模式（窗构造等细部不展开）：{model.degradeReasons.join('、')}
            </p>
          )}

          {model.omissions?.length > 0 && (
            <p className="mt-1.5 text-[11px] leading-snug text-muted">
              未建模：{model.omissions.map((o) => o.label).join(' · ')} —— 照片中不可见，不臆想。
            </p>
          )}
        </div>
      )}
    </div>
  )
}
