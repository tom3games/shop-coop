// テストと調整用の自動店員（ラーメン屋）。人と同じ操作（act）と、人と同じ歩く速さだけで営業する。
// 障害物は避けずにまっすぐ歩く（距離の目安が合えばよい）。ゲーム本体は使わない。
// 1杯ずつ「麺を茹でる→丼→スープ→（味）→茹で上がりを待って盛る→トッピング→出す」を受け持つ。
// 2人以上なら最後の1人は手伝い役（会計・器を下げる・洗う・麺の補充）。
import { SIM, stationSize, collide } from '../public/shared/sim.js'
import { BOIL } from '../public/shared/shops/ramen.js'

export function makeBots(sim, shop, ids, { skill = 1 } = {}) {
  const S = sim.state
  const claimed = new Set() // 受け持った注文（客id:行）・下げる器・会計など
  const bots = ids.map((id, i) => ({ id, support: ids.length >= 2 && i === ids.length - 1, job: null, wait: 0, task: null }))

  function standPoint(st, from) {
    const [w, d] = stationSize(st, shop)
    const c = [[st.x, st.z + d / 2 + 0.5], [st.x, st.z - d / 2 - 0.5], [st.x - w / 2 - 0.5, st.z], [st.x + w / 2 + 0.5, st.z]]
    let best = null, bd = 1e9
    for (const [x, z] of c) {
      const [cx, cz] = collide(x, z, sim.obs, sim.area)
      if (Math.hypot(cx - x, cz - z) > 0.05) continue
      const dd = Math.hypot(x - from.x, z - from.z)
      if (dd < bd) { bd = dd; best = [x, z] }
    }
    return best || collide(st.x, st.z + d / 2 + 0.5, sim.obs, sim.area)
  }
  function goalPoint(p, t) {
    if (t.k === 'cu') { const c = S.customers.find(c => c.id === t.id); return c && collide(c.x, 0.2, sim.obs, sim.area) }
    if (t.k === 'it') {
      const it = S.items[t.id]; if (!it || it.at[0] !== 'st') return null
      const st = S.stations[it.at[1]]
      if (st.type === 'counter') return collide(shop.layout.spots[it.at[2]][0], 0.2, sim.obs, sim.area)
      return standPoint(st, p)
    }
    const st = S.stations[t.id]
    return st && standPoint(st, p)
  }

  const openLines = () => {
    const out = []
    for (const c of S.customers) if (c.st === 'order' || c.st === 'enter') c.order.forEach((l, i) => { if (!l.done && !claimed.has(c.id + ':' + i)) out.push({ c, l, i }) })
    return out.sort((a, b) => (b.c.st === 'order') - (a.c.st === 'order') || b.c.wait / b.c.patience - a.c.wait / a.c.patience)
  }
  const freeBoiler = () => Object.values(S.stations).find(s => s.type === 'boiler' && s.slots.includes(null))
  const held = p => p.hold && S.items[p.hold]
  const claim = k => { if (claimed.has(k)) return false; claimed.add(k); return true }

  // 会計・器を下げる・洗う・補充
  function chore(p, onlyUrgent) {
    const h = held(p)
    if (h?.type === 'dirty') return S.stations.sink.slots.includes(null) ? { k: 'st', id: 'sink' } : null
    if (h?.type === 'crate') return { k: 'st', id: 'noodles' }
    if (h) return null
    if (S.customers.some(c => c.st === 'pay' && c.payIdx === 0 && c.arrived) && claim('pay')) return { k: 'st', id: 'register', release: 'pay' }
    if (S.stations.noodles.stock <= 2 && !Object.values(S.items).some(i => i.type === 'crate') && claim('crate')) return { k: 'st', id: 'crates', release: 'crate' }
    const urgent = S.stations.bowls.stock <= 2 || S.customers.some(c => c.st === 'queue')
    if (onlyUrgent && !urgent) return null
    if (S.stations.sink.slots.includes(null)) for (const id of S.stations.counter.slots) if (id && claim(id)) return { k: 'it', id, release: id }
    return null
  }

  // 受け持った1杯の次の一手
  function cook(b, p) {
    const j = b.job
    const h = held(p)
    const c = S.customers.find(c => c.id === j.cust)
    const line = c?.order[j.i]
    if (!c || !line || line.done || !(c.st === 'order' || c.st === 'enter')) {
      // 客がいなくなった: 待っている別の客に回す
      claimed.delete(j.cust + ':' + j.i)
      const o = openLines()[0]
      if (o) { j.cust = o.c.id; j.i = o.i; claimed.add(o.c.id + ':' + o.i); return cook(b, p) }
      b.job = null
      return h?.type === 'bowl' ? { k: 'st', id: 'trash' } : null
    }
    const nd = j.noodle && S.items[j.noodle]
    if (!(h?.type === 'bowl' && h.noodle != null)) {
      if (!nd) {
        j.noodle = null
        if (h?.type === 'noodle') { const bo = freeBoiler(); return bo ? { k: 'st', id: bo.id, boil: true } : null }
        if (h?.type === 'bowl') return { k: 'st', id: 'trash' } // 麺が無くなった丼は中身を捨てて洗いに回す
        if (h) return chore(p, false)
        if (S.stations.noodles.stock <= 0 || !freeBoiler()) return chore(p, false)
        return { k: 'st', id: 'noodles' }
      }
    }
    if (!h) return S.stations.bowls.stock > 0 ? { k: 'st', id: 'bowls' } : chore(p, false)
    if (h.type !== 'bowl') return null
    if (!h.soup) return { k: 'st', id: 'soup' }
    if (line.koi && !h.koi) return { k: 'st', id: 'tare' }
    if (line.oil && !h.oil) return { k: 'st', id: 'abura' }
    if (h.noodle == null) {
      const [a] = BOIL.windows[line.hard || 'normal']
      if (nd.cook < a + 0.3) { b.hover = { k: 'it', id: nd.id }; return null }
      return { k: 'it', id: nd.id }
    }
    for (const t of ['negi', ...(line.top || [])]) if (!h.top.includes(t)) return { k: 'st', id: t }
    return { k: 'cu', id: c.id, done: true }
  }

  function decide(b) {
    const p = S.players[b.id]
    if (b.support) return chore(p, false)
    const urgent = chore(p, true)
    if (urgent) return urgent
    if (!b.job) {
      const o = openLines()[0]
      if (!o) return chore(p, false)
      b.job = { cust: o.c.id, i: o.i, noodle: null }
      claimed.add(o.c.id + ':' + o.i)
    }
    return cook(b, p)
  }

  return {
    bots,
    update(dt) {
      for (const b of bots) {
        const p = S.players[b.id]
        if (!p || p.away) continue
        if (b.wait > 0) { b.wait -= dt; continue }
        if (!b.task) {
          b.hover = null
          b.task = decide(b)
          if (!b.task) {
            // 茹で上がり待ち: 茹で釜の前で待つ
            if (b.hover) { const g = goalPoint(p, b.hover); if (g) { p.x = g[0]; p.z = g[1] } }
            b.wait = 0.25; continue
          }
        }
        const g = goalPoint(p, b.task)
        if (!g) { if (b.task.release) claimed.delete(b.task.release); b.task = null; continue }
        const dx = g[0] - p.x, dz = g[1] - p.z, d = Math.hypot(dx, dz)
        const s = SIM.walk * skill * dt
        if (d > 0.08) {
          const k = Math.min(1, s / d)
          p.x += dx * k; p.z += dz * k; p.yaw = Math.atan2(dx, dz)
          if (d > s) continue
        }
        const holding = p.hold
        const r = sim.act(b.id, b.task)
        if (b.task.release) claimed.delete(b.task.release)
        if (r.ok && b.task.boil && b.job) b.job.noodle = holding // 茹で始めた麺を覚える
        if (r.ok && b.task.done) b.job = null
        b.task = null
        b.wait = (r.ok ? 0.35 : 0.3) / skill
      }
    }
  }
}
