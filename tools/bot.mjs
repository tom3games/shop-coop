// テストと調整用の自動店員。人と同じ操作（act と setPose）だけで営業する。歩く速さも人と同じ。
// 障害物は避けずにまっすぐ歩く（距離の目安が合えばよい）。ゲーム本体は使わない。
import { SIM, stationSize, collide } from '../public/shared/sim.js'

export function makeBots(sim, shop, ids, { skill = 1 } = {}) {
  const S = sim.state
  const claims = new Map() // 仕事 -> bot id（同じ仕事を2人でしない）
  const bots = ids.map(id => ({ id, goal: null, task: null, wait: 0 }))

  function standPoint(st, from) {
    const [w, d] = stationSize(st)
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

  const needs = () => {
    // まだ渡していない注文の行（待つ場所に着いている客のみ）
    const out = []
    for (const c of S.customers) if (c.st === 'order' || c.st === 'enter') c.order.forEach((l, i) => { if (!l.done) out.push({ c, l, i }) })
    return out
  }
  const inProgress = type => Object.values(S.items).filter(it => it.type === type || (type === 'drink' && it.type === 'cup')).length
  const stations = type => Object.values(S.stations).filter(s => s.type === type)

  function choose(b) {
    const p = S.players[b.id]
    const held = p.hold && S.items[p.hold]
    const B = shop.bake
    if (held) {
      if (held.type === 'dough' || (held.type === 'bread' && held.cook < B.windows.normal[0] - 1)) {
        const o = stations('oven').find(o => !o.slots[0])
        if (o) return { k: 'st', id: o.id }
      }
      if (held.type === 'cup') { const d = stations('drinker').find(d => !d.slots[0]); if (d) return { k: 'st', id: d.id } }
      if (held.type === 'crate') return { k: 'st', id: 'dough' }
      if (held.type === 'bread' || held.type === 'drink') {
        const n = needs().filter(n => n.l.p === held.type && n.c.st === 'order' && n.c.arrived)
        if (n.length) return { k: 'cu', id: n.sort((a, b) => (b.c.wait / b.c.patience) - (a.c.wait / a.c.patience))[0].c.id }
        if (held.type === 'bread' && held.cook >= B.burnt) return { k: 'st', id: 'trash' }
      }
      const t = stations('table').find(t => t.slots.includes(null))
      return t ? { k: 'st', id: t.id } : { k: 'st', id: 'trash' }
    }
    const claim = key => { if (claims.has(key) && claims.get(key) !== b.id) return false; claims.set(key, b.id); return true }
    // 会計
    if (S.customers.some(c => c.st === 'pay' && c.payIdx === 0 && c.arrived) && claim('pay')) return { k: 'st', id: 'register' }
    // 焼けたパン・できたドリンク
    const ns = needs()
    for (const o of stations('oven')) {
      const it = o.slots[0] && S.items[o.slots[0]]
      if (!it) continue
      const wantWell = ns.some(n => n.l.p === 'bread' && n.l.opt === 'well')
      const ready = it.cook >= (wantWell ? B.windows.well[0] + 0.3 : B.windows.normal[0] + 0.4)
      if ((ready || it.cook >= B.windows.normal[1] - 0.3 && !wantWell) && claim('oven:' + o.id)) return { k: 'st', id: o.id }
    }
    for (const d of stations('drinker')) {
      const it = d.slots[0] && S.items[d.slots[0]]
      if (it && it.type === 'drink' && claim('drink:' + d.id)) return { k: 'st', id: d.id }
    }
    for (const t of stations('table')) for (const iid of t.slots) {
      const it = iid && S.items[iid]
      const useful = ns.some(n => n.l.p === it?.type) || (it?.type === 'dough' && stations('oven').some(o => !o.slots[0]))
      if (it && useful && claim('item:' + iid)) return { k: 'it', id: iid }
    }
    const box = S.stations.dough
    const carrying = Object.values(S.items).some(it => it.type === 'crate')
    if (box.stock <= 1 && !carrying && claim('crate')) return { k: 'st', id: 'crates' }
    const needBread = ns.filter(n => n.l.p === 'bread').length - inProgress('bread') - Object.values(S.items).filter(i => i.type === 'dough').length
    if (needBread > 0 && box.stock > 0 && stations('oven').some(o => !o.slots[0]) && claim('dough')) return { k: 'st', id: 'dough' }
    const needDrink = ns.filter(n => n.l.p === 'drink').length - inProgress('drink')
    if (needDrink > 0 && stations('drinker').some(d => !d.slots[0]) && claim('cup')) return { k: 'st', id: 'cups' }
    return null
  }

  function goalPoint(b, target) {
    const p = S.players[b.id]
    if (target.k === 'cu') { const c = S.customers.find(c => c.id === target.id); return c ? collide(c.x, 0.2, sim.obs, sim.area) : null }
    const sid = target.k === 'it' ? S.items[target.id]?.at[1] : target.id
    const st = S.stations[sid]
    return st ? standPoint(st, p) : null
  }

  return {
    bots,
    // dt 秒ぶん、各 bot を歩かせて操作させる
    update(dt) {
      for (const b of bots) {
        const p = S.players[b.id]
        if (!p || p.away) continue
        if (b.wait > 0) { b.wait -= dt; continue }
        if (!b.task) {
          for (const [k, v] of claims) if (v === b.id) claims.delete(k)
          b.task = choose(b)
          if (!b.task) { b.wait = 0.4; continue }
        }
        const g = goalPoint(b, b.task)
        if (!g) { b.task = null; continue }
        const dx = g[0] - p.x, dz = g[1] - p.z, d = Math.hypot(dx, dz)
        const s = SIM.walk * skill * dt
        if (d > 0.08) {
          const k = Math.min(1, s / d)
          p.x += dx * k; p.z += dz * k; p.yaw = Math.atan2(dx, dz) // 障害物は抜けて歩く（距離の目安だけ合わせる）
          if (d > s) continue
        }
        const r = sim.act(b.id, b.task)
        b.task = null
        b.wait = r.ok ? 0.35 / skill : 0.3 // 人が押すまでの間
      }
    }
  }
}
