// 営業の仕組み（店の種類によらない共通部分）。サーバーとブラウザ（ひとりで営業）の両方がこのファイルをそのまま動かす。
// 店固有のもの（商品・設備・置き場所・注文の追加条件）は shops/*.js から受け取る。
//
// 流れ: 客が来る → 待つ場所で注文を出す → 店員が作って渡す → 全部そろったらレジに並ぶ → 会計 → 食べて帰る／持ち帰る
// 状態はすべて素の JSON（そのまま画面へ送れる）。画面は state を受け取り、actionFor() で「いま照準の先で何ができるか」を出す。

export const SIM = {
  step: 1 / 30,     // 営業の時間はこの刻みで進める（描画の速さに左右されない）
  walk: 3.0,        // 店員の歩く速さ（m/秒）
  run: 4.6,
  shoesMul: 1.2,
  custWalk: 1.5,    // 客の歩く速さ
  reach: 1.9,       // 設備のふちからこの距離まで手が届く
  reachCustomer: 2.7,
  payPatience: 45,  // レジで待ってくれる秒数。過ぎると自分で払って帰る（満足度は下がる）
  eatSec: [8, 13],
  playerR: 0.32
}

// 人数による客の多さ（2人を 1 とする）。1人でも4人でも回るように
export const CROWD = [0, 0.7, 1, 1.15, 1.3]

// 設備の大きさ（幅 x 奥行き、高さ）。当たり判定と見た目の両方に使う
export const STATION_SIZE = {
  oven: [1.4, 0.9, 1.15], doughbox: [0.9, 1.2, 0.85], crates: [1.3, 1.0, 0.9], drinker: [1.0, 0.8, 1.25],
  cups: [0.8, 0.8, 0.95], trash: [0.6, 0.6, 0.8], register: [0.9, 0.8, 1.0]
}
export function stationSize(st) {
  if (st.type === 'table') return [st.w, st.d, 0.9]
  return STATION_SIZE[st.type] || [1, 1, 1]
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const r2 = v => Math.round(v * 100) / 100

// 簡単な乱数（同じ種なら同じ営業になる。テストで使う）
export function makeRng(seed = Date.now()) {
  let s = (seed >>> 0) || 1
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
}

// ---- 当たり判定（画面の歩行とサーバーの確認の両方で使う）
export function obstacles(shop, upgrades = {}) {
  const out = []
  const c = shop.layout.counter
  out.push([c.x0, c.z0, c.x1, c.z1])
  for (const st of shop.stations) {
    if (st.upgrade && !upgrades[st.upgrade]) continue
    const [w, d] = stationSize(st)
    out.push([st.x - w / 2, st.z - d / 2, st.x + w / 2, st.z + d / 2])
  }
  return out
}

// 円（店員）を四角の障害物と歩ける範囲から押し出す
export function collide(x, z, obs, area, r = SIM.playerR) {
  x = clamp(x, area[0] + r, area[2] - r)
  z = clamp(z, area[1] + r, area[3] - r)
  for (let k = 0; k < 2; k++) {
    for (const [x0, z0, x1, z1] of obs) {
      const nx = clamp(x, x0, x1), nz = clamp(z, z0, z1)
      const dx = x - nx, dz = z - nz
      const d2 = dx * dx + dz * dz
      if (d2 >= r * r) continue
      if (d2 > 1e-9) { const d = Math.sqrt(d2); x = nx + (dx / d) * r; z = nz + (dz / d) * r }
      else {
        // 中心が四角の中: いちばん近い辺から出す
        const m = [x - x0, x1 - x, z - z0, z1 - z]
        const i = m.indexOf(Math.min(...m))
        if (i === 0) x = x0 - r; else if (i === 1) x = x1 + r; else if (i === 2) z = z0 - r; else z = z1 + r
      }
    }
  }
  return [x, z]
}

// 焼き加減から品質（0〜100）。注文の「よく焼き」などの指定で、ちょうどの範囲が変わる
export function bakeQuality(shop, cook, opt) {
  const b = shop.bake
  const [a, z] = b.windows[opt === 'well' ? 'well' : 'normal']
  const off = cook < a ? a - cook : cook > z ? cook - z : 0
  let q = 100 - off * b.lossPerSec
  if (cook >= b.burnt) q = Math.min(q, 15)
  return Math.round(clamp(q, 5, 100))
}
export function bakeLabel(shop, cook) {
  const b = shop.bake
  if (cook >= b.burnt) return '焦げ'
  if (cook < b.windows.normal[0] - 2) return '生焼け'
  if (cook < b.windows.normal[0]) return 'もう少し'
  if (cook <= b.windows.normal[1]) return 'ちょうど'
  if (cook < b.windows.well[0]) return 'しっかり'
  if (cook <= b.windows.well[1]) return 'よく焼き'
  return '焼きすぎ'
}

function dist2Rect(px, pz, st) {
  const [w, d] = stationSize(st)
  const dx = Math.max(Math.abs(px - st.x) - w / 2, 0), dz = Math.max(Math.abs(pz - st.z) - d / 2, 0)
  return Math.hypot(dx, dz)
}

// 品目が注文のどの行に当たるか（未完成の行のうち、指定まで一致するものを優先）
function matchLine(shop, cust, item) {
  const lines = cust.order.map((l, i) => ({ l, i })).filter(o => !o.l.done && o.l.p === item.type)
  if (!lines.length) return -1
  if (item.type === 'bread') {
    let best = lines[0], bq = -1
    for (const o of lines) { const q = bakeQuality(shop, item.cook || 0, o.l.opt); if (q > bq) { bq = q; best = o } }
    return best.i
  }
  return lines[0].i
}

// ---- 照準の先でできること（画面の案内とサーバーの確認で同じものを使う）
// target: { k: 'st', id } 設備 / { k: 'it', id } 置いてある物 / { k: 'cu', id } 客
// 戻り値: { kind, label } か null
export function actionFor(state, shop, pid, target) {
  const p = state.players[pid]
  if (!p || !target || state.over) return null
  const held = p.hold ? state.items[p.hold] : null
  if (target.k === 'it') {
    const it = state.items[target.id]
    if (!it || it.at[0] !== 'st') return null
    return actionFor(state, shop, pid, { k: 'st', id: it.at[1], item: it.id })
  }
  if (target.k === 'cu') {
    const c = state.customers.find(c => c.id === target.id)
    if (!c) return null
    if (Math.hypot(c.x - p.x, c.z - p.z) > SIM.reachCustomer) return null
    if (c.st === 'order' && c.arrived) {
      if (!held) return { kind: 'look', label: '注文を見る', none: true }
      return matchLine(shop, c, held) >= 0 ? { kind: 'serve', label: '渡す' } : { kind: 'wrong', label: '頼まれていない', none: true }
    }
    return null
  }
  if (target.k !== 'st') return null
  const st = state.stations[target.id]
  if (!st) return null
  if (dist2Rect(p.x, p.z, st) > SIM.reach) return null
  const has = st.slots ? st.slots.filter(Boolean) : []
  switch (st.type) {
    case 'oven':
      if (held && (held.type === 'dough' || held.type === 'bread') && has.length < st.slots.length) return { kind: 'put', label: held.type === 'dough' ? '焼く' : 'もう一度焼く' }
      if (!held && has.length) return { kind: 'take', label: '取り出す' }
      return null
    case 'drinker':
      if (held && held.type === 'cup' && has.length < st.slots.length) return { kind: 'put', label: 'ドリンクを入れる' }
      if (!held && has.length) return { kind: 'take', label: state.items[has[0]].type === 'drink' ? '取る' : 'カップを戻す' }
      return null
    case 'table':
      if (held && has.length < st.slots.length) return { kind: 'put', label: '置く' }
      if (!held && has.length) return { kind: 'take', label: '持つ' }
      return null
    case 'doughbox':
      if (held && held.type === 'crate') return { kind: 'refill', label: '補充する' }
      if (!held && st.stock > 0) return { kind: 'take', label: `生地を取る（残り${st.stock}）` }
      if (!held) return { kind: 'empty', label: '空っぽ。材料の箱を運ぶ', none: true }
      return null
    case 'crates':
      return !held ? { kind: 'take', label: '材料の箱を持つ' } : null
    case 'cups':
      return !held ? { kind: 'take', label: 'カップを取る' } : null
    case 'trash':
      return held ? { kind: 'trash', label: '捨てる' } : null
    case 'register': {
      const c = state.customers.find(c => c.st === 'pay' && c.payIdx === 0 && c.arrived)
      return c ? { kind: 'pay', label: '会計する' } : null
    }
  }
  return null
}

export function createSim({ shop, location, players = [], upgrades = {}, duration = 420, seed, phases }) {
  const rng = makeRng(seed ?? (Date.now() & 0xffffffff))
  const PH = phases
  const L = shop.layout
  const area = L.staffArea
  const obs = obstacles(shop, upgrades)
  const COLORS = ['#ff9f43', '#4fc3f7', '#f06292', '#9ccc65']
  let nextId = 1
  const id = p => p + (nextId++)

  const state = {
    t: 0, duration, phase: 0, over: false, location: location.name,
    players: {}, items: {}, stations: {}, customers: [],
    stats: { custN: 0, served: 0, angry: 0, turned: 0, orders: 0, lines: 0, linesDone: 0, qSum: 0, qN: 0, satSum: 0, satN: 0, sales: 0, cost: 0, tips: 0 },
    seq: 0
  }
  const events = []
  const emit = (type, data = {}) => { events.push({ type, t: r2(state.t), ...data }); state.seq++ }

  for (const st of shop.stations) {
    if (st.upgrade && !upgrades[st.upgrade]) continue
    const s = { id: st.id, type: st.type, x: st.x, z: st.z }
    if (st.type === 'oven' || st.type === 'drinker') s.slots = [null]
    if (st.type === 'table') s.slots = st.slots.map(() => null)
    if (st.type === 'doughbox') { s.max = upgrades.bigbox ? shop.doughStock.maxBig : shop.doughStock.max; s.stock = shop.doughStock.start }
    state.stations[st.id] = s
  }

  function addPlayer(pid, name) {
    if (state.players[pid]) { state.players[pid].away = false; return }
    const n = Object.keys(state.players).length
    const [sx, sz] = L.spawn
    state.players[pid] = { id: pid, name: String(name || '店員').slice(0, 12), color: COLORS[n % 4], x: sx - n * 0.9, z: sz - 0.4, yaw: 0, pitch: -0.12, hold: null, away: false }
  }
  for (const p of players) addPlayer(p.id, p.name)

  const activeCount = () => Object.values(state.players).filter(p => !p.away).length

  function removePlayer(pid) {
    const p = state.players[pid]
    if (!p) return
    // 持っていた物は足元の作業台に戻す（無ければ消える）
    if (p.hold) dropToTable(p.hold)
    p.hold = null
    p.away = true
  }
  function dropToTable(itemId) {
    for (const st of Object.values(state.stations)) {
      if (st.type !== 'table') continue
      const i = st.slots.indexOf(null)
      if (i >= 0) { st.slots[i] = itemId; state.items[itemId].at = ['st', st.id, i]; return }
    }
    delete state.items[itemId]
  }

  // 店員の位置は各画面が動かす（遅れなく歩けるように）。ここでは範囲と壁だけ確かめる
  function setPose(pid, pose) {
    const p = state.players[pid]
    if (!p || !pose) return
    const { x, z, yaw, pitch } = pose
    if (![x, z, yaw, pitch].every(v => typeof v === 'number' && Number.isFinite(v))) return
    const [cx, cz] = collide(x, z, obs, area)
    p.x = r2(cx); p.z = r2(cz)
    p.yaw = Math.round(yaw * 1000) / 1000
    p.pitch = Math.round(clamp(pitch, -1.5, 1.5) * 1000) / 1000
  }

  function phaseAt(t) {
    const f = t / duration
    let i = 0
    while (i < PH.length - 1 && f >= PH[i + 1].from) i++
    return i
  }

  // ---- 客
  let nextSpawn = 4
  function makeOrder(ph) {
    const n = 1 + Math.floor(rng() * ph.maxItems)
    const wellFrom = PH.findIndex(p => p.id === shop.options.well.from)
    const lines = []
    for (let i = 0; i < n; i++) {
      const p = rng() < 0.5 ? 'bread' : 'drink'
      const l = { p, done: false, q: 0 }
      if (p === 'bread' && state.phase >= wellFrom && rng() < location.wellShare) l.opt = 'well'
      lines.push(l)
    }
    // 同じ物は並べて見やすく
    lines.sort((a, b) => (a.p + (a.opt || '')).localeCompare(b.p + (b.opt || '')))
    return lines
  }
  function freeSpot() {
    const used = new Set(state.customers.filter(c => c.spot != null).map(c => c.spot))
    for (let i = 0; i < L.spots.length; i++) if (!used.has(i)) return i
    return -1
  }
  function freeQueue() {
    const used = new Set(state.customers.filter(c => c.qi != null).map(c => c.qi))
    for (let i = 0; i < L.queue.length; i++) if (!used.has(i)) return i
    return -1
  }
  function walkTo(c, pts) { c.path = pts.map(([x, z]) => [x, z]); c.arrived = false }

  function spawn() {
    const ph = PH[state.phase]
    state.stats.custN++
    const [dx, dz] = L.door
    const c = {
      id: id('c'), st: 'enter', x: dx, z: dz + 0.4, yaw: Math.PI, path: [], arrived: false,
      order: makeOrder(ph), wait: 0, patience: Math.round(ph.patience * location.patienceMul), mood: 'happy',
      look: Math.floor(rng() * 6), spot: null, qi: null, payIdx: null, say: null, sayT: 0, eatIn: rng() < location.eatIn
    }
    c.patience = Math.round(c.patience * (1 + 0.15 * (c.order.length - 1)))
    const s = freeSpot()
    if (s >= 0) { c.spot = s; c.st = 'enter'; walkTo(c, [[dx, 8.2], [L.spots[s][0], 3.4], L.spots[s]]) }
    else {
      const q = freeQueue()
      if (q < 0) { state.stats.turned++; emit('turned'); return } // 店がいっぱいで入れなかった
      c.qi = q; c.st = 'queue'; walkTo(c, [L.queue[q]])
    }
    state.customers.push(c)
    emit('arrive', { id: c.id })
  }

  function say(c, text, sec = 2.2) { c.say = text; c.sayT = sec }

  function toPayLine(c) {
    const used = state.customers.filter(o => o.st === 'pay').length
    c.st = 'pay'; c.payIdx = used; c.payWait = 0
    c.spot = null
    const p = L.payLine[Math.min(used, L.payLine.length - 1)]
    walkTo(c, [[c.x, 3.2], [p[0], 3.2], p])
    pullQueue()
  }
  function shiftPayLine() {
    const line = state.customers.filter(o => o.st === 'pay').sort((a, b) => a.payIdx - b.payIdx)
    line.forEach((o, i) => { if (o.payIdx !== i) { o.payIdx = i; walkTo(o, [L.payLine[Math.min(i, L.payLine.length - 1)]]) } })
  }
  function pullQueue() {
    for (;;) {
      const s = freeSpot()
      if (s < 0) return
      const q = state.customers.filter(c => c.st === 'queue').sort((a, b) => a.qi - b.qi)[0]
      if (!q) return
      q.qi = null; q.spot = s; q.st = 'enter'
      walkTo(q, [[L.spots[s][0], 3.4], L.spots[s]])
    }
  }

  function bill(c, served) {
    let sum = 0
    for (const l of c.order) if (l.done) sum += shop.products[l.p].price * location.priceMul * (0.5 + 0.5 * l.q / 100)
    let tip = 0
    if (served && c.wait < c.patience * 0.35) tip = Math.round(sum * 0.1)
    return { sum: Math.round(sum), tip }
  }
  function satisfaction(c, extraPenalty = 0) {
    const done = c.order.filter(l => l.done)
    const q = done.length ? done.reduce((a, l) => a + l.q, 0) / c.order.length : 0
    const wf = 1 - 0.45 * clamp(c.wait / c.patience, 0, 1)
    return Math.round(clamp(q * wf - extraPenalty, 0, 100))
  }
  function leave(c, kind) {
    c.st = kind // 'leave' | 'angry'
    c.spot = null; c.qi = null
    const [dx, dz] = L.door
    walkTo(c, [[c.x, Math.max(c.z, 3.4)], [dx, 8.2], [dx, dz + 0.6]])
  }

  function pay(c, byStaff) {
    const { sum, tip } = bill(c, byStaff)
    const total = sum + (byStaff ? tip : 0)
    state.stats.sales += total
    state.stats.tips += byStaff ? tip : 0
    state.stats.served++
    const sat = satisfaction(c, byStaff ? 0 : 30)
    state.stats.satSum += sat; state.stats.satN++
    c.mood = sat >= 75 ? 'happy' : sat >= 45 ? 'ok' : 'sad'
    say(c, byStaff ? (tip ? 'はやい！' : 'どうも') : '待たされた…', 2.4)
    emit('pay', { id: c.id, amount: total, tip: byStaff ? tip : 0, auto: !byStaff })
    c.payIdx = null
    if (c.eatIn) {
      const used = new Set(state.customers.filter(o => o.seat != null).map(o => o.seat))
      const s = L.seats.findIndex((_, i) => !used.has(i))
      if (s >= 0) {
        c.seat = s; c.st = 'eat'; c.eatT = SIM.eatSec[0] + rng() * (SIM.eatSec[1] - SIM.eatSec[0])
        walkTo(c, [[c.x, 5.6], L.seats[s]])
        shiftPayLine()
        return
      }
    }
    leave(c, 'leave')
    shiftPayLine()
  }

  function stepCustomers(dt) {
    const ph = PH[state.phase]
    for (const c of state.customers) {
      if (c.sayT > 0) { c.sayT -= dt; if (c.sayT <= 0) c.say = null }
      // 歩く
      if (c.path.length) {
        const [tx, tz] = c.path[0]
        const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz)
        const s = SIM.custWalk * dt
        if (d <= s) { c.x = tx; c.z = tz; c.path.shift(); if (!c.path.length) c.arrived = true }
        else { c.x += (dx / d) * s; c.z += (dz / d) * s; c.yaw = Math.atan2(dx, dz) }
      }
      if (c.arrived && (c.st === 'order' || c.st === 'enter' || c.st === 'pay')) c.yaw = Math.PI // カウンター（厨房）の方を向く
      if (c.st === 'enter' && c.arrived) {
        c.st = 'order'
        state.stats.orders++; state.stats.lines += c.order.length
        say(c, 'お願いします', 1.6)
        emit('order', { id: c.id, n: c.order.length })
      }
      if (c.st === 'queue') c.wait += dt * 0.4
      if (c.st === 'order') {
        c.wait += dt
        const f = c.wait / c.patience
        const prev = c.mood
        c.mood = f < 0.45 ? 'happy' : f < 0.7 ? 'ok' : f < 0.88 ? 'sad' : 'angry'
        if (c.mood !== prev && (c.mood === 'sad' || c.mood === 'angry')) { say(c, c.mood === 'angry' ? 'まだ？' : 'まだかな', 2); emit('impatient', { id: c.id, mood: c.mood }) }
        if (c.wait >= c.patience) {
          // 怒って帰る。渡した分だけは払っていく（失敗を取り返せないほど重くしない）
          const { sum } = bill(c, false)
          state.stats.sales += sum
          state.stats.angry++
          state.stats.satSum += satisfaction(c, 40); state.stats.satN++
          c.mood = 'angry'; say(c, 'もういい！', 2.5)
          emit('angry', { id: c.id, amount: sum })
          leave(c, 'angry')
          pullQueue()
        }
      }
      if (c.st === 'pay') {
        c.payWait += dt
        if (c.payWait > SIM.payPatience && c.payIdx === 0) pay(c, false)
      }
      if (c.st === 'eat' && c.arrived) {
        c.eatT -= dt
        if (c.eatT <= 0) { c.seat = null; leave(c, 'leave') }
      }
    }
    // 出口に着いた客を消す
    state.customers = state.customers.filter(c => !((c.st === 'leave' || c.st === 'angry') && c.arrived))
    // 新しい客
    if (ph.interval > 0 && state.t >= nextSpawn) {
      spawn()
      const n = Math.max(1, activeCount())
      nextSpawn = state.t + ph.interval * (0.75 + rng() * 0.5) / location.rateMul / CROWD[Math.min(4, n)]
    }
  }

  function stepStations(dt) {
    const b = shop.bake
    for (const st of Object.values(state.stations)) {
      if (st.type === 'oven') {
        const it = st.slots[0] && state.items[st.slots[0]]
        if (!it) continue
        const before = it.cook
        it.cook = Math.round((it.cook + dt) * 1000) / 1000
        if (before < b.windows.normal[0] && it.cook >= b.windows.normal[0]) emit('baked', { st: st.id, kind: 'normal' })
        if (before < b.windows.well[0] && it.cook >= b.windows.well[0]) emit('baked', { st: st.id, kind: 'well' })
        if (before < b.burnt && it.cook >= b.burnt) emit('burnt', { st: st.id })
      }
      if (st.type === 'drinker') {
        const it = st.slots[0] && state.items[st.slots[0]]
        if (!it || it.type !== 'cup') continue
        it.fill = Math.min(1, (it.fill || 0) + dt / shop.brewSec)
        if (it.fill >= 1) { it.type = 'drink'; emit('brewed', { st: st.id }) }
      }
    }
  }

  function step(dt) {
    if (state.over) return
    state.t += dt
    const pi = phaseAt(state.t)
    if (pi !== state.phase) { state.phase = pi; emit('phase', { phase: PH[pi].id, name: PH[pi].name }) }
    stepStations(dt)
    stepCustomers(dt)
    if (state.t >= duration) {
      state.over = true
      emit('close')
    }
  }

  let acc = 0
  function tick(dt) {
    acc += clamp(Number(dt) || 0, 0, 0.5)
    while (acc >= SIM.step - 1e-9 && !state.over) { step(SIM.step); acc -= SIM.step }
  }

  // ---- 操作。actionFor で確かめてから実行する（画面の案内と食い違わない）
  function act(pid, target) {
    if (!target || typeof target !== 'object' || !['st', 'it', 'cu'].includes(target.k) || typeof target.id !== 'string') return { error: 'bad_target' }
    const a = actionFor(state, shop, pid, { k: target.k, id: target.id })
    if (!a || a.none) return { error: 'cannot' }
    const p = state.players[pid]
    const held = p.hold ? state.items[p.hold] : null
    const grab = it => { p.hold = it.id; it.at = ['pl', pid] }
    const newItem = (type, extra = {}) => { const it = { id: id('i'), type, at: ['pl', pid], ...extra }; state.items[it.id] = it; p.hold = it.id; return it }
    const release = () => { const it = held; p.hold = null; return it }

    if (a.kind === 'serve') {
      const c = state.customers.find(c => c.id === target.id)
      const li = matchLine(shop, c, held)
      const line = c.order[li]
      line.q = held.type === 'bread' ? bakeQuality(shop, held.cook || 0, line.opt) : 100
      line.done = true
      state.stats.linesDone++; state.stats.qSum += line.q; state.stats.qN++
      delete state.items[held.id]; p.hold = null
      say(c, line.q >= 90 ? 'いいね！' : line.q >= 60 ? 'ありがとう' : line.q >= 30 ? 'うーん…' : 'これは…', 1.8)
      emit('serve', { id: c.id, q: line.q, p: line.p, by: pid })
      if (c.order.every(l => l.done)) toPayLine(c)
      return { ok: true, kind: a.kind }
    }
    const sid = target.k === 'it' ? state.items[target.id].at[1] : target.id
    const st = state.stations[sid]
    switch (a.kind) {
      case 'put': {
        const it = release()
        // 置ける所のうち照準に近い場所（物を直接狙っていたらその隣）へ
        const i = st.slots.indexOf(null)
        st.slots[i] = it.id; it.at = ['st', st.id, i]
        if (st.type === 'oven' && it.type === 'dough') { it.type = 'bread'; it.cook = 0 }
        if (st.type === 'drinker') it.fill = it.fill || 0
        emit('put', { st: st.id, by: pid, item: it.type })
        break
      }
      case 'take': {
        if (st.slots) {
          let i = target.k === 'it' ? st.slots.indexOf(target.id) : st.slots.findIndex(Boolean)
          if (i < 0) i = st.slots.findIndex(Boolean)
          const it = state.items[st.slots[i]]
          st.slots[i] = null
          if (st.type === 'drinker' && it.type === 'cup') it.fill = 0
          grab(it)
          emit('take', { st: st.id, by: pid, item: it.type, cook: it.cook })
        } else if (st.type === 'doughbox') {
          st.stock--
          newItem('dough')
          emit('take', { st: st.id, by: pid, item: 'dough', stock: st.stock })
          if (st.stock === 0) emit('stockout', { st: st.id })
        } else if (st.type === 'crates') {
          newItem('crate')
          emit('take', { st: st.id, by: pid, item: 'crate' })
        } else if (st.type === 'cups') {
          newItem('cup', { fill: 0 })
          emit('take', { st: st.id, by: pid, item: 'cup' })
        }
        break
      }
      case 'refill': {
        const it = release(); delete state.items[it.id]
        st.stock = st.max
        state.stats.cost += shop.items.crate.cost
        emit('refill', { st: st.id, by: pid })
        break
      }
      case 'trash': {
        const it = release(); delete state.items[it.id]
        emit('trash', { by: pid, item: it.type })
        break
      }
      case 'pay': {
        const c = state.customers.find(c => c.st === 'pay' && c.payIdx === 0 && c.arrived)
        pay(c, true)
        break
      }
      default: return { error: 'cannot' }
    }
    return { ok: true, kind: a.kind }
  }

  function result() {
    const s = state.stats
    return {
      location: location.name,
      sales: s.sales, cost: s.cost, profit: s.sales - s.cost, tips: s.tips,
      customers: s.custN, served: s.served, angry: s.angry, turned: s.turned,
      lines: s.lines, linesDone: s.linesDone,
      success: s.custN ? Math.round((s.served / s.custN) * 100) : 0,
      quality: s.qN ? Math.round(s.qSum / s.qN) : 0,
      satisfaction: s.satN ? Math.round(s.satSum / s.satN) : 0,
      staff: Object.values(state.players).map(p => p.name)
    }
  }

  return {
    state, events, obs, area,
    tick, act, setPose, addPlayer, removePlayer,
    drainEvents() { return events.splice(0) },
    isOver: () => state.over,
    result,
    _step: step
  }
}
