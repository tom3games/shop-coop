// 営業の仕組み（店の種類によらない共通部分）。サーバーとブラウザ（ひとりで営業）の両方がこのファイルをそのまま動かす。
// 店固有のもの（品物・設備の動き・注文の中身と品質・配置）は shops/*.js の SHOP から受け取る。
//
// 共通で持つもの: 店員（持つ・置く）、置き台（table）、品物の補給所（supply）、ゴミ箱、レジ、席のカウンター（counter）、
//                 客（来店・席・注文・待つ・受け取る・食べる・会計・退店）、売上、時間帯の進行、結果
// 店が持つもの:   SHOP.types（設備ごとの「いまできること」と時間の経過）、SHOP.order（注文の作り方・品質・出せる状態か）
// 状態はすべて素の JSON（そのまま画面へ送れる）。画面は actionFor() で「照準の先で何ができるか」を出す。

export const SIM = {
  step: 1 / 30,
  walk: 3.0,
  run: 4.6,
  shoesMul: 1.2,
  custWalk: 1.5,
  reach: 1.9,          // 設備のふちからこの距離まで手が届く
  reachCustomer: 2.7,
  payPatience: 45,     // レジで待ってくれる秒数。過ぎると自分で払って帰る（満足度は下がる）
  playerR: 0.32
}

// 人数による客の多さ（2人を 1 とする）
export const CROWD = [0, 0.7, 1, 1.15, 1.3]

// 共通の設備の大きさ（幅・奥行き・高さ）
const CORE_SIZE = { supply: [0.9, 1.0, 0.85], trash: [0.6, 0.6, 0.8], register: [0.9, 0.8, 1.0] }
export function stationSize(def, shop) {
  if (def.type === 'table') return [def.w, def.d, 0.9]
  if (def.type === 'counter') return [0, 0, 1]
  return shop?.types[def.type]?.size || CORE_SIZE[def.type] || [1, 1, 1]
}
// 設備の置き場所（改善で動く物がある）
export function stationDefs(shop, upgrades = {}) {
  const out = []
  for (const d of shop.stations) {
    if (d.upgrade && !upgrades[d.upgrade]) continue
    out.push(d.alt && upgrades[d.alt.upgrade] ? { ...d, x: d.alt.x, z: d.alt.z } : d)
  }
  return out
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const r2 = v => Math.round(v * 100) / 100

export function makeRng(seed = Date.now()) {
  let s = (seed >>> 0) || 1
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
}

// ---- 当たり判定（画面の歩行とサーバーの確認の両方で使う）
export function obstacles(shop, upgrades = {}) {
  const c = shop.layout.counter
  const out = [[c.x0, c.z0, c.x1, c.z1]]
  for (const d of stationDefs(shop, upgrades)) {
    if (d.type === 'counter') continue
    const [w, dd] = stationSize(d, shop)
    out.push([d.x - w / 2, d.z - dd / 2, d.x + w / 2, d.z + dd / 2])
  }
  return out
}
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
        const m = [x - x0, x1 - x, z - z0, z1 - z]
        const i = m.indexOf(Math.min(...m))
        if (i === 0) x = x0 - r; else if (i === 1) x = x1 + r; else if (i === 2) z = z0 - r; else z = z1 + r
      }
    }
  }
  return [x, z]
}

// 席のカウンターに置かれた物の場所（席ごと）
export function slotPoint(shop, st, i) {
  if (st.type === 'counter') { const [x] = shop.layout.spots[i]; return [x, (shop.layout.counter.z0 + shop.layout.counter.z1) / 2] }
  return [st.x, st.z]
}
function distRect(px, pz, st, shop) {
  const [w, d] = stationSize(st, shop)
  const dx = Math.max(Math.abs(px - st.x) - w / 2, 0), dz = Math.max(Math.abs(pz - st.z) - d / 2, 0)
  return Math.hypot(dx, dz)
}

// 品物が注文のどの行に当たるか（品質がいちばん高くなる行）
function matchLine(shop, cust, item) {
  let best = -1, bq = -1
  cust.order.forEach((l, i) => {
    if (l.done || l.p !== shop.order.product(item)) return
    const { q } = shop.order.quality(l, item)
    if (q > bq) { bq = q; best = i }
  })
  return best
}

// ---- 照準の先でできること（画面の案内とサーバーの確認で同じものを使う）
// target: { k: 'st', id } 設備 / { k: 'it', id } 置いてある物 / { k: 'cu', id } 客
// 戻り値: { kind, label, none?, run? } か null（run はサーバー側で実行に使う）
export function actionFor(state, shop, pid, target) {
  const p = state.players[pid]
  if (!p || p.away || !target || state.over) return null
  const held = p.hold ? state.items[p.hold] : null
  if (target.k === 'cu') {
    const c = state.customers.find(c => c.id === target.id)
    if (!c || Math.hypot(c.x - p.x, c.z - p.z) > SIM.reachCustomer) return null
    if (c.st === 'order' && c.arrived) {
      if (!held) return { kind: 'look', label: '注文を見る', none: true }
      if (!shop.order.servable(held)) return { kind: 'wrong', label: 'まだ出せない', none: true }
      return matchLine(shop, c, held) >= 0 ? { kind: 'serve', label: '出す', cust: c.id } : { kind: 'wrong', label: '頼まれていない', none: true }
    }
    return null
  }
  let st, itemId = null
  if (target.k === 'it') {
    const it = state.items[target.id]
    if (!it || it.at[0] !== 'st') return null
    st = state.stations[it.at[1]]
    itemId = it.id
    if (st && st.type === 'counter') {
      const [x, z] = slotPoint(shop, st, it.at[2])
      if (Math.hypot(x - p.x, z - p.z) > SIM.reach + 0.6) return null
    }
  } else if (target.k === 'st') st = state.stations[target.id]
  if (!st) return null
  if (st.type !== 'counter' && distRect(p.x, p.z, st, shop) > SIM.reach) return null
  const def = shop.stations.find(d => d.id === st.id)
  const has = st.slots ? st.slots.filter(Boolean) : []
  switch (st.type) {
    case 'table':
      if (held && has.length < st.slots.length) return { kind: 'put', label: '置く', run: a => a.slotPut(st, a.release()) }
      if (!held && has.length) return { kind: 'take', label: '持つ', run: a => a.grab(a.slotTake(st, itemId)) }
      return null
    case 'counter':
      // 食べ終わった器などを下げる（物を直接狙ったときだけ）
      if (!held && itemId) return { kind: 'take', label: '下げる', run: a => a.grab(a.slotTake(st, itemId)) }
      return null
    case 'supply': {
      const name = shop.items[def.item].name
      if (held && def.refill && held.type === def.refill) return { kind: 'refill', label: '補充する', run: a => { a.destroy(a.release()); st.stock = st.max; a.S.stats.cost += shop.items[def.refill].cost || 0; a.emit('refill', { st: st.id }) } }
      if (held) return null
      if (st.stock != null && st.stock <= 0) return { kind: 'empty', label: `空っぽ。${shop.items[def.refill]?.name || '在庫'}を運ぶ`, none: true }
      return { kind: 'take', label: st.stock != null ? `${name}を取る（残り${st.stock}）` : `${name}を持つ`, run: a => { if (st.stock != null) { st.stock--; if (!st.stock) a.emit('stockout', { st: st.id }) } a.newItem(def.item); a.emit('take', { st: st.id, item: def.item }) } }
    }
    case 'trash':
      return held ? { kind: 'trash', label: held.type === 'bowl' ? '中身を捨てる' : '捨てる', run: a => { a.emit('trash', { item: held.type }); if ((shop.onTrash?.(held, a) || 'remove') === 'remove') a.destroy(a.release()) } } : null
    case 'register': {
      const c = state.customers.find(c => c.st === 'pay' && c.payIdx === 0 && c.arrived)
      return c ? { kind: 'pay', label: '会計する', cust: c.id } : null
    }
  }
  const T = shop.types[st.type]
  return T ? T.action({ S: state, st, def, p, held, target: itemId, shop }) : null
}

export function createSim({ shop, location, players = [], upgrades = {}, duration = 420, seed }) {
  const rng = makeRng(seed ?? (Date.now() & 0xffffffff))
  const PH = shop.phases
  const L = shop.layout
  const area = L.staffArea
  const obs = obstacles(shop, upgrades)
  const COLORS = ['#ff9f43', '#4fc3f7', '#f06292', '#9ccc65']
  let nextId = 1
  const id = p => p + (nextId++)

  const state = {
    t: 0, duration, phase: 0, over: false, location: location.name, shop: shop.id,
    players: {}, items: {}, stations: {}, customers: [],
    stats: { custN: 0, served: 0, angry: 0, turned: 0, orders: 0, lines: 0, linesDone: 0, qSum: 0, qN: 0, satSum: 0, satN: 0, sales: 0, cost: 0, tips: 0 },
    seq: 0
  }
  const events = []
  const emit = (type, data = {}) => { events.push({ type, t: r2(state.t), ...data }); state.seq++ }

  for (const d of stationDefs(shop, upgrades)) {
    const s = { id: d.id, type: d.type, x: d.x, z: d.z }
    if (d.type === 'table') s.slots = d.slots.map(() => null)
    if (d.type === 'counter') s.slots = L.spots.map(() => null)
    if (d.type === 'supply' && d.stock) { s.stock = d.stock.start; s.max = d.stock.max }
    Object.assign(s, shop.types[d.type]?.init?.(d, upgrades) || {})
    state.stations[d.id] = s
  }

  // 設備の動きに渡す道具
  let actor = null
  const api = {
    S: state, emit: (t, d = {}) => emit(t, { by: actor, ...d }),
    newItem(type, extra = {}) { const p = state.players[actor]; const it = { id: id('i'), type, at: ['pl', actor], ...extra }; state.items[it.id] = it; p.hold = it.id; return it },
    release() { const p = state.players[actor]; const it = state.items[p.hold]; p.hold = null; return it },
    grab(it) { const p = state.players[actor]; p.hold = it.id; it.at = ['pl', actor] },
    destroy(it) { delete state.items[it.id] },
    slotPut(st, it, i = st.slots.indexOf(null)) { st.slots[i] = it.id; it.at = ['st', st.id, i]; emit('put', { st: st.id, by: actor, item: it.type }) },
    slotTake(st, itemId) { let i = itemId ? st.slots.indexOf(itemId) : -1; if (i < 0) i = st.slots.findIndex(Boolean); const it = state.items[st.slots[i]]; st.slots[i] = null; emit('take', { st: st.id, by: actor, item: it.type }); return it }
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
  const counter = () => state.stations.counter
  function freeSpot() {
    const used = new Set(state.customers.filter(c => c.spot != null).map(c => c.spot))
    for (let i = 0; i < L.spots.length; i++) if (!used.has(i) && !(counter() && counter().slots[i])) return i
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
    const order = [shop.order.make(rng, ph, location)]
    const c = {
      id: id('c'), st: 'enter', x: dx, z: dz + 0.4, yaw: Math.PI, path: [], arrived: false,
      order: order.map(l => ({ ...l, done: false, q: 0 })), wait: 0, patience: Math.round(ph.patience * location.patienceMul), mood: 'happy',
      look: Math.floor(rng() * 6), spot: null, qi: null, payIdx: null, say: null, sayT: 0
    }
    const s = freeSpot()
    if (s >= 0) { c.spot = s; walkTo(c, [[dx, 8.2], [L.spots[s][0], 3.2], L.spots[s]]) }
    else {
      const q = freeQueue()
      if (q < 0) { state.stats.turned++; emit('turned'); return }
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
      walkTo(q, [[q.x, 3.2], [L.spots[s][0], 3.2], L.spots[s]])
    }
  }
  function bill(c, tipOk) {
    let sum = 0
    for (const l of c.order) if (l.done) sum += shop.products[l.p].price * location.priceMul * (0.5 + 0.5 * l.q / 100)
    const tip = tipOk && c.wait < c.patience * 0.35 ? Math.round(sum * 0.1) : 0
    return { sum: Math.round(sum), tip }
  }
  function satisfaction(c, penalty = 0) {
    const q = c.order.reduce((a, l) => a + (l.done ? l.q : 0), 0) / c.order.length
    const wf = 1 - 0.45 * clamp(c.wait / c.patience, 0, 1)
    return Math.round(clamp(q * wf - penalty, 0, 100))
  }
  function leave(c, kind) {
    c.st = kind
    c.spot = null; c.qi = null
    const [dx, dz] = L.door
    walkTo(c, [[c.x, Math.max(c.z, 3.2)], [dx, 8.2], [dx, dz + 0.6]])
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
    say(c, byStaff ? (tip ? 'また来ます！' : 'どうも') : '待たされた…', 2.4)
    emit('pay', { id: c.id, amount: total, tip: byStaff ? tip : 0, auto: !byStaff })
    c.payIdx = null
    leave(c, 'leave')
    shiftPayLine()
  }
  // 食べ終わり: 席に器を残してレジへ（器を下げるまで次の客はその席に座れない）
  function finishEating(c) {
    const ct = counter()
    if (ct && shop.seated?.leftover && c.spot != null) {
      const it = { id: id('i'), type: shop.seated.leftover, at: ['st', ct.id, c.spot] }
      state.items[it.id] = it
      ct.slots[c.spot] = it.id
    }
    emit('ate', { id: c.id })
    toPayLine(c)
  }

  function stepCustomers(dt) {
    const ph = PH[state.phase]
    for (const c of state.customers) {
      if (c.sayT > 0) { c.sayT -= dt; if (c.sayT <= 0) c.say = null }
      if (c.path.length) {
        const [tx, tz] = c.path[0]
        const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz)
        const s = SIM.custWalk * dt
        if (d <= s) { c.x = tx; c.z = tz; c.path.shift(); if (!c.path.length) c.arrived = true }
        else { c.x += (dx / d) * s; c.z += (dz / d) * s; c.yaw = Math.atan2(dx, dz) }
      }
      if (c.arrived && ['order', 'enter', 'pay', 'eat'].includes(c.st)) c.yaw = Math.PI // カウンター（厨房）の方を向く
      if (c.st === 'enter' && c.arrived) {
        c.st = 'order'
        state.stats.orders++; state.stats.lines += c.order.length
        say(c, '注文いいですか', 1.6)
        emit('order', { id: c.id, n: c.order.length })
      }
      if (c.st === 'queue') c.wait += dt * 0.35
      if (c.st === 'order') {
        c.wait += dt
        const f = c.wait / c.patience
        const prev = c.mood
        c.mood = f < 0.45 ? 'happy' : f < 0.7 ? 'ok' : f < 0.88 ? 'sad' : 'angry'
        if (c.mood !== prev && (c.mood === 'sad' || c.mood === 'angry')) { say(c, c.mood === 'angry' ? 'まだ？' : 'まだかな', 2); emit('impatient', { id: c.id, mood: c.mood }) }
        if (c.wait >= c.patience) {
          // 怒って帰る。出した分は払っていく（取り返せないほど重くしない）
          const { sum } = bill(c, false)
          state.stats.sales += sum
          state.stats.angry++
          state.stats.satSum += satisfaction(c, 40); state.stats.satN++
          c.mood = 'angry'; say(c, 'もういい！', 2.5)
          emit('angry', { id: c.id, amount: sum })
          leave(c, 'angry')
        }
      }
      if (c.st === 'eat') { c.eatT -= dt; if (c.eatT <= 0) finishEating(c) }
      if (c.st === 'pay') { c.payWait += dt; if (c.payWait > SIM.payPatience && c.payIdx === 0 && c.arrived) pay(c, false) }
    }
    state.customers = state.customers.filter(c => !((c.st === 'leave' || c.st === 'angry') && c.arrived))
    if (ph.interval > 0 && state.t >= nextSpawn) {
      spawn()
      const n = Math.max(1, activeCount())
      nextSpawn = state.t + ph.interval * (0.75 + rng() * 0.5) / location.rateMul / CROWD[Math.min(4, n)]
    }
    // 席が空いたら（器を下げたら）並んでいる客を呼ぶ
    if (state.customers.some(c => c.st === 'queue')) pullQueue()
  }

  function step(dt) {
    if (state.over) return
    state.t += dt
    const pi = phaseAt(state.t)
    if (pi !== state.phase) { state.phase = pi; emit('phase', { phase: PH[pi].id, name: PH[pi].name }) }
    actor = null
    for (const st of Object.values(state.stations)) shop.types[st.type]?.tick?.(st, dt, api)
    stepCustomers(dt)
    if (state.t >= duration) { state.over = true; emit('close') }
  }

  let acc = 0
  function tick(dt) {
    acc += clamp(Number(dt) || 0, 0, 0.5)
    while (acc >= SIM.step - 1e-9 && !state.over) { step(SIM.step); acc -= SIM.step }
  }

  function act(pid, target) {
    if (!target || typeof target !== 'object' || !['st', 'it', 'cu'].includes(target.k) || typeof target.id !== 'string') return { error: 'bad_target' }
    const a = actionFor(state, shop, pid, { k: target.k, id: target.id })
    if (!a || a.none) return { error: 'cannot' }
    actor = pid
    const p = state.players[pid]
    if (a.kind === 'serve' && a.cust) {
      const held = state.items[p.hold]
      const c = state.customers.find(c => c.id === a.cust)
      const line = c.order[matchLine(shop, c, held)]
      const { q, say: text } = shop.order.quality(line, held)
      line.q = q; line.done = true
      state.stats.linesDone++; state.stats.qSum += q; state.stats.qN++
      api.destroy(held); p.hold = null
      say(c, text, 2.4)
      emit('serve', { id: c.id, q, by: pid })
      if (c.order.every(l => l.done)) {
        if (shop.seated) { c.st = 'eat'; c.eatT = shop.seated.eatSec[0] + rng() * (shop.seated.eatSec[1] - shop.seated.eatSec[0]); c.mood = q >= 75 ? 'happy' : q >= 45 ? 'ok' : 'sad' }
        else toPayLine(c)
      }
    } else if (a.kind === 'pay' && a.cust) pay(state.customers.find(c => c.id === a.cust), true)
    else if (a.run) a.run(api)
    else { actor = null; return { error: 'cannot' } }
    actor = null
    return { ok: true, kind: a.kind }
  }

  function result() {
    const s = state.stats
    return {
      location: location.name, shop: shop.name,
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
    state, obs, area,
    tick, act, setPose, addPlayer, removePlayer,
    drainEvents() { return events.splice(0) },
    isOver: () => state.over,
    result
  }
}
