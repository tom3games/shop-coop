// ラーメン屋。この店だけの物（品物・設備の動き・注文の中身・品質・配置・時間帯・出店場所・設備の改善）をここに書く。
// 共通の仕組み（客の来店と退店・注文の受け渡し・会計・売上・時間帯の進行・結果）は shared/sim.js が持ち、
// ここの types / order を呼ぶだけ。別の店にするときはこのファイルを複製して書き換える。
//
// 流れ: 麺の箱から麺 → 茹で釜（てぼ）で茹でる → 丼を取って寸胴でスープ → 茹で釜から麺を丼に盛る → ネギ（と注文のトッピング）
//       → カウンター越しに出す → 客が食べる → 席に残った丼を下げて洗う → レジで会計
// 座標はメートル。x は右、z は手前（客席側）が正。厨房は z < 0.6、カウンターの向こうが客席。

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

// 麺の茹で時間（秒）。硬さの指定ごとに「ちょうど」の範囲がある。過ぎるとのびる
export const BOIL = {
  windows: { kata: [5.0, 6.6], normal: [7.2, 8.8], yawa: [9.6, 11.4] },
  nobi: 15,        // ここを過ぎるとのびた麺（渡せるが品質は大きく下がる）
  lossPerSec: 14,  // 範囲から1秒外れるごとに下がる品質
  maxShow: 18      // ゲージの右端
}
export const HARD = { kata: '硬め', normal: '普通', yawa: '柔らかめ' }
export const TOPPINGS = { negi: 'ネギ', chashu: 'チャーシュー', ajitama: '味玉' }
export const FLAGS = { koi: '味濃いめ', oil: '油多め' }

// 茹で加減の呼び名（画面に出す）
export function boilLabel(t) {
  const w = BOIL.windows
  if (t >= BOIL.nobi) return 'のびた'
  if (t < w.kata[0]) return '生っぽい'
  if (t <= w.kata[1]) return '硬め'
  if (t < w.normal[0]) return '硬め寄り'
  if (t <= w.normal[1]) return '普通'
  if (t < w.yawa[0]) return '柔らかめ寄り'
  if (t <= w.yawa[1]) return '柔らかめ'
  return 'のびかけ'
}
export function noodleQuality(t, hard = 'normal') {
  const [a, z] = BOIL.windows[hard] || BOIL.windows.normal
  const off = t < a ? a - t : t > z ? t - z : 0
  let q = 100 - off * BOIL.lossPerSec
  if (t >= BOIL.nobi) q = Math.min(q, 20)
  return Math.round(clamp(q, 5, 100))
}

// 丼がそろっているか（スープと麺が入っていれば出せる。足りないトッピングなどは減点で済ませる）
const servable = it => it && it.type === 'bowl' && it.soup && it.noodle != null

// 注文1杯ぶんの品質と、客のひとこと
function quality(line, it) {
  let q = noodleQuality(it.noodle, line.hard)
  let say = null
  const nq = q
  if (it.noodle >= BOIL.nobi) say = 'のびてる…'
  else if (nq < 70) say = it.noodle < BOIL.windows[line.hard || 'normal'][0] ? 'かたっ' : 'やわっ'
  for (const k of ['negi', ...(line.top || [])]) if (!it.top?.includes(k)) { q -= 22; say = say || `${TOPPINGS[k]}は？` }
  for (const k of Object.keys(FLAGS)) if (!!line[k] !== !!it[k]) { q -= 18; say = say || (line[k] ? (k === 'koi' ? '薄い…' : '油が足りない') : (k === 'koi' ? 'しょっぱ！' : 'ギトギト…')) }
  q = Math.round(clamp(q, 5, 100))
  if (!say) say = q >= 90 ? 'うまい！' : q >= 70 ? 'いいね' : 'うーん'
  return { q, say }
}

function makeLine(rng, ph, loc) {
  const l = { p: 'ramen', hard: 'normal', top: [] }
  const f = ph.adds || {}
  if (f.hard && rng() < loc.hardShare) l.hard = rng() < 0.55 ? 'kata' : 'yawa'
  if (f.flags) { if (rng() < loc.flagShare) l.koi = true; if (rng() < loc.flagShare * 0.8) l.oil = true }
  if (f.top && rng() < loc.topShare) l.top = rng() < 0.5 ? ['ajitama'] : rng() < 0.6 ? ['chashu'] : ['chashu', 'ajitama']
  return l
}
// 注文票・吹き出しに出す短い指定（普通の1杯なら空）
export function lineTags(l) {
  const t = []
  if (l.hard && l.hard !== 'normal') t.push(HARD[l.hard])
  if (l.koi) t.push('濃いめ')
  if (l.oil) t.push('油多め')
  for (const k of l.top || []) t.push('+' + TOPPINGS[k])
  return t
}

// ---- 設備の動き。action(ctx) は「いまできること」を返し、run(api) で実行する
const types = {
  // 茹で釜: てぼ（slots）に麺を入れると茹で始める。丼（スープ入り）を持って使うと、いちばん茹でた麺（狙った麺）を盛る
  boiler: {
    size: [1.6, 0.9, 0.95],
    init: (def, up) => ({ slots: Array(up.tebo ? 3 : 2).fill(null) }),
    action({ st, held, S, target }) {
      const has = st.slots.filter(Boolean)
      if (held?.type === 'noodle') {
        if (has.length < st.slots.length) return { kind: 'put', label: '麺を茹でる', run: a => { const it = a.release(); it.cook = 0; a.slotPut(st, it) } }
        return { kind: 'full', label: 'てぼがいっぱい', none: true }
      }
      if (held?.type === 'bowl') {
        if (!has.length) return null
        if (held.noodle != null) return { kind: 'full', label: 'もう麺が入っている', none: true }
        if (!held.soup) return { kind: 'need', label: '先にスープを入れる', none: true }
        // 狙った麺、なければいちばん茹でた麺
        let i = target && st.slots.indexOf(target)
        if (i == null || i < 0) { let best = -1; st.slots.forEach((id, k) => { if (id && (best < 0 || S.items[id].cook > S.items[st.slots[best]].cook)) best = k }); i = best }
        const nd = S.items[st.slots[i]]
        return { kind: 'serve', label: `麺を盛る（${boilLabel(nd.cook)}）`, run: a => { st.slots[i] = null; held.noodle = nd.cook; a.destroy(nd); a.emit('plate', { cook: nd.cook }) } }
      }
      if (!held && has.length) return { kind: 'info', label: '丼（スープ入り）を持って盛る', none: true }
      return null
    },
    tick(st, dt, a) {
      for (const id of st.slots) {
        const it = id && a.S.items[id]
        if (!it) continue
        const b = it.cook
        it.cook = Math.round((it.cook + dt) * 1000) / 1000
        for (const [k, [s]] of Object.entries(BOIL.windows)) if (b < s && it.cook >= s) a.emit('boiled', { st: st.id, kind: k })
        if (b < BOIL.nobi && it.cook >= BOIL.nobi) a.emit('nobi', { st: st.id })
      }
    }
  },
  // 寸胴: 空の丼を持って使うとスープが入る
  soup: {
    size: [1.0, 0.9, 1.0],
    action({ held }) {
      if (held?.type !== 'bowl') return null
      if (held.soup) return { kind: 'full', label: 'スープは入っている', none: true }
      return { kind: 'pour', label: 'スープを入れる', run: a => { held.soup = true; a.emit('pour') } }
    }
  },
  // かえし（味濃いめ）と油（油多め）: スープ入りの丼に足す
  flavor: {
    size: [0.6, 0.6, 1.0],
    action({ held, def }) {
      if (held?.type !== 'bowl') return null
      if (!held.soup) return { kind: 'need', label: '先にスープ', none: true }
      if (held[def.flag]) return { kind: 'full', label: `${FLAGS[def.flag]}にしてある`, none: true }
      return { kind: 'pour', label: FLAGS[def.flag] + 'にする', run: a => { held[def.flag] = true; a.emit('flavor', { flag: def.flag }) } }
    }
  },
  // トッピング: 麺の入った丼にのせる
  topping: {
    size: [0.7, 0.6, 0.95],
    action({ held, def }) {
      if (held?.type !== 'bowl') return null
      if (held.noodle == null) return { kind: 'need', label: '先に麺を盛る', none: true }
      if (held.top.includes(def.top)) return { kind: 'full', label: `${TOPPINGS[def.top]}はのっている`, none: true }
      return { kind: 'top', label: TOPPINGS[def.top] + 'をのせる', run: a => { held.top.push(def.top); a.emit('top', { top: def.top }) } }
    }
  },
  // 丼置き: 洗った丼の数だけ取れる
  bowls: {
    size: [0.9, 0.7, 0.9],
    init: (def, up) => { const max = up.bowls ? 10 : 6; return { stock: max, max } },
    action({ held, st }) {
      if (held) return null
      if (st.stock <= 0) return { kind: 'empty', label: '丼がない。洗い場で洗う', none: true }
      return { kind: 'take', label: `丼を取る（残り${st.stock}）`, run: a => { st.stock--; a.newItem('bowl', { soup: false, noodle: null, top: [] }); if (!st.stock) a.emit('nobowl') } }
    }
  },
  // 洗い場: 下げた丼を入れると少しで洗い上がり、丼置きに戻る
  sink: {
    size: [1.2, 0.8, 0.9],
    init: () => ({ slots: [null, null] }),
    action({ held, st }) {
      if (held?.type !== 'dirty') return null
      if (st.slots.every(Boolean)) return { kind: 'full', label: '洗い場がいっぱい', none: true }
      return { kind: 'put', label: '洗う', run: a => { const it = a.release(); it.wash = 0; a.slotPut(st, it) } }
    },
    tick(st, dt, a) {
      st.slots.forEach((id, i) => {
        const it = id && a.S.items[id]
        if (!it) return
        it.wash = Math.min(1, (it.wash || 0) + dt / 2.4)
        if (it.wash >= 1) {
          st.slots[i] = null; a.destroy(it)
          const b = a.S.stations.bowls; b.stock = Math.min(b.max, b.stock + 1)
          a.emit('washed')
        }
      })
    }
  }
}

// 捨てる: 丼は中身だけ捨てて、洗う丼になる（丼は減らない）
function onTrash(it, a) {
  if (it.type === 'bowl') { it.type = 'dirty'; delete it.soup; delete it.noodle; delete it.top; delete it.koi; delete it.oil; return 'keep' }
  if (it.type === 'dirty') return 'keep'
  return 'remove'
}

export const SHOP = {
  id: 'ramen',
  name: 'ラーメン 仮屋',
  short: '仮屋',
  products: { ramen: { name: 'ラーメン', price: 850 } },
  items: {
    noodle: { name: '麺（生）' }, bowl: { name: '丼' }, dirty: { name: '食べ終わった丼' },
    crate: { name: '麺の箱', cost: 400 }
  },
  types, onTrash,
  order: { make: makeLine, quality, servable, tags: lineTags, product: it => (it.type === 'bowl' ? 'ramen' : null) },
  // 食べ終わった客は席に丼を残してレジへ。丼を下げるまで次の客はその席に座れない
  seated: { eatSec: [9, 14], leftover: 'dirty' },

  stations: [
    { id: 'noodles', type: 'supply', item: 'noodle', stock: { start: 8, max: 8 }, refill: 'crate', x: -6.25, z: -2.6, label: '麺の箱' },
    { id: 'crates', type: 'supply', item: 'crate', x: 6.0, z: -4.2, label: '麺の在庫' },
    { id: 'boiler1', type: 'boiler', x: -4.6, z: -4.3, label: '茹で釜' },
    { id: 'boiler2', type: 'boiler', x: -2.8, z: -4.3, label: '茹で釜2', upgrade: 'boiler2' },
    { id: 'soup', type: 'soup', x: -0.9, z: -4.3, label: '寸胴' },
    { id: 'tare', type: 'flavor', flag: 'koi', x: 0.3, z: -4.45, label: 'かえし' },
    { id: 'abura', type: 'flavor', flag: 'oil', x: 1.05, z: -4.45, label: '背脂' },
    { id: 'bowls', type: 'bowls', x: 2.4, z: -4.3, label: '丼' },
    // トッピング台。「トッピング台を寄せる」を買うと作業台の横（盛り付けの近く）に移る
    { id: 'negi', type: 'topping', top: 'negi', x: 4.0, z: -4.4, alt: { upgrade: 'neartop', x: -1.0, z: -0.95 }, label: 'ネギ' },
    { id: 'chashu', type: 'topping', top: 'chashu', x: 4.8, z: -4.4, alt: { upgrade: 'neartop', x: -0.3, z: -0.95 }, label: 'チャーシュー' },
    { id: 'ajitama', type: 'topping', top: 'ajitama', x: 6.45, z: -2.9, alt: { upgrade: 'neartop', x: 0.4, z: -0.95 }, label: '味玉' },
    { id: 'island', type: 'table', x: 0, z: -1.9, w: 3.0, d: 1.0, slots: [[-1.05, 0], [-0.35, 0], [0.35, 0], [1.05, 0]], label: '作業台' },
    { id: 'sink', type: 'sink', x: 6.2, z: -0.9, label: '洗い場' },
    { id: 'trash', type: 'trash', x: -6.35, z: -0.6, label: 'ゴミ箱' },
    { id: 'register', type: 'register', x: 4.6, z: 1.0, label: 'レジ' },
    { id: 'counter', type: 'counter', label: 'カウンター' }
  ],

  layout: {
    floor: [-7, -5, 7, 10.5],
    counter: { x0: -7, x1: 3.9, z0: 0.6, z1: 1.4 },
    // 席（カウンター）。客はここに座って注文し、ここで食べる
    spots: [[-5.6, 2.0], [-4.0, 2.0], [-2.4, 2.0], [-0.8, 2.0], [0.8, 2.0], [2.4, 2.0]],
    payLine: [[4.6, 2.15], [4.6, 3.1], [4.6, 4.0], [4.6, 4.9], [5.6, 5.6], [5.6, 6.5]],
    door: [0, 10.2],
    queue: [[-1.6, 8.9], [-0.8, 8.9], [0.8, 8.9], [1.6, 8.9], [-2.4, 8.9]], // 待ち椅子（店内の入り口わき）
    seats: [],
    tables: [],
    spawn: [0.8, 0.4],
    staffArea: [-6.75, -4.75, 6.75, 0.45]
  }
}

// 出店場所。上位互換にしない（駅前は客が多いが待たない、住宅街は少ないが注文がこまかい）
export const LOCATIONS = {
  residential: {
    name: '住宅街', lead: '客は少なめ。常連が多く、硬さや味の好みをよく言う',
    priceMul: 1.0, patienceMul: 1.3, rateMul: 0.85, hardShare: 0.7, flagShare: 0.5, topShare: 0.6
  },
  station: {
    name: '駅前', lead: '客が多く、待ってくれない。値段は高め。注文は普通が多い',
    priceMul: 1.2, patienceMul: 0.85, rateMul: 1.3, hardShare: 0.4, flagShare: 0.3, topShare: 0.35
  }
}

// 営業の流れ。from は営業開始からの割合。interval は客が来る間隔（秒、2人のとき）。
// 新しい難しさは1段ずつ: 普通だけ → 麺の硬さ → 味濃いめ・油多め → トッピング指定
export const PHASES = [
  { id: 'open', name: '開店', news: 'まずは普通のラーメンから', from: 0, interval: 24, patience: 110, adds: {} },
  { id: 'hard', name: '昼前', news: '麺の硬さの注文が来る（硬め・柔らかめ）', from: 0.2, interval: 17, patience: 100, adds: { hard: 1 } },
  { id: 'flags', name: '昼', news: '「味濃いめ」「油多め」が来る', from: 0.45, interval: 13, patience: 95, adds: { hard: 1, flags: 1 } },
  { id: 'peak', name: 'ピーク', news: 'トッピングの追加が来る。全員で回そう', from: 0.7, interval: 10, patience: 90, adds: { hard: 1, flags: 1, top: 1 } },
  { id: 'close', name: '閉店前', news: '新しいお客さんは来ない。残りを片付けよう', from: 0.93, interval: 0, patience: 90, adds: { hard: 1, flags: 1, top: 1 } }
]

export const UPGRADES = {
  boiler2: { name: '茹で釜2口目', cost: 900, lead: '茹で釜がもう1台。同時にたくさん茹でられる' },
  tebo: { name: 'てぼの追加', cost: 500, lead: '1台の茹で釜で3玉まで茹でられる' },
  neartop: { name: 'トッピング台を寄せる', cost: 400, lead: 'ネギ・チャーシュー・味玉を作業台の横へ' },
  bowls: { name: '丼を増やす', cost: 300, lead: '丼が6個から10個に。洗うのが少し後でよくなる' },
  shoes: { name: '厨房用の靴', cost: 300, lead: '歩く速さが2割上がる' }
}

export const DEFAULT_LOCATION = 'residential'

SHOP.phases = PHASES
SHOP.locations = LOCATIONS
SHOP.upgrades = UPGRADES
