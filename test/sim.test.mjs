// 営業の仕組みの単体テスト（通信なし）
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSim, actionFor, bakeQuality, collide, obstacles, SIM } from '../public/shared/sim.js'
import { SHOP, LOCATIONS, PHASES } from '../public/shared/shops/prototype.js'
import { makeBots } from '../tools/bot.mjs'

const mk = (n = 1, o = {}) => createSim({ shop: SHOP, location: LOCATIONS[o.loc || 'residential'], players: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })), duration: o.duration || 420, seed: o.seed ?? 3, phases: PHASES, upgrades: o.upgrades || {} })
const near = (sim, pid, x, z) => { const p = sim.state.players[pid]; p.x = x; p.z = z }
const atDough = (sim, pid = 'p0') => near(sim, pid, -5.3, -1.6)
const atOven = (sim, pid = 'p0') => near(sim, pid, -5.0, -3.4)
const run = (sim, sec) => { for (let t = 0; t < sec; t += 1 / 30) sim.tick(1 / 30) }
function customerWith(sim, lines) {
  // 注文を決めて待つ場所に立たせる
  run(sim, 0.1)
  const c = { id: 'cx' + Math.random(), st: 'order', arrived: true, x: -1.2, z: 2.15, yaw: Math.PI, path: [], order: lines.map(l => ({ done: false, q: 0, ...l })), wait: 0, patience: 80, mood: 'happy', look: 0, spot: 2, qi: null, payIdx: null, say: null, sayT: 0, eatIn: false }
  sim.state.customers.push(c)
  return c
}

test('生地を取る→オーブン→取り出す→渡す→会計 が通る', () => {
  const sim = mk(1)
  atDough(sim)
  assert.equal(actionFor(sim.state, SHOP, 'p0', { k: 'st', id: 'dough' }).kind, 'take')
  assert.ok(sim.act('p0', { k: 'st', id: 'dough' }).ok)
  assert.equal(sim.state.stations.dough.stock, SHOP.doughStock.start - 1)
  // 手がふさがっていると、もう取れない
  assert.ok(sim.act('p0', { k: 'st', id: 'dough' }).error)
  atOven(sim)
  assert.ok(sim.act('p0', { k: 'st', id: 'oven1' }).ok)
  const bread = sim.state.items[sim.state.stations.oven1.slots[0]]
  assert.equal(bread.type, 'bread')
  run(sim, 7.5)
  assert.ok(sim.act('p0', { k: 'st', id: 'oven1' }).ok)
  const c = customerWith(sim, [{ p: 'bread' }])
  near(sim, 'p0', -1.2, 0.2)
  const r = sim.act('p0', { k: 'cu', id: c.id })
  assert.ok(r.ok, JSON.stringify(r))
  assert.equal(c.order[0].q, 100)
  assert.equal(c.st, 'pay')
  run(sim, 6) // レジまで歩く
  near(sim, 'p0', 4.6, 0.2)
  assert.equal(actionFor(sim.state, SHOP, 'p0', { k: 'st', id: 'register' }).kind, 'pay')
  const before = sim.state.stats.sales
  assert.ok(sim.act('p0', { k: 'st', id: 'register' }).ok)
  assert.ok(sim.state.stats.sales > before)
  assert.equal(sim.state.stats.served, 1)
})

test('焼き加減で品質が決まる。よく焼きの注文はちょうどの範囲がずれる。焦げても渡せる', () => {
  assert.equal(bakeQuality(SHOP, 7.5, null), 100)
  assert.ok(bakeQuality(SHOP, 7.5, 'well') < 60)
  assert.equal(bakeQuality(SHOP, 11.5, 'well'), 100)
  assert.ok(bakeQuality(SHOP, 3, null) < 50)
  assert.ok(bakeQuality(SHOP, 20, null) <= 15)
  assert.ok(bakeQuality(SHOP, 20, null) >= 5)
})

test('頼まれていない物は渡せない（そのまま持っている）', () => {
  const sim = mk(1)
  near(sim, 'p0', 4.0, -3.4)
  sim.act('p0', { k: 'st', id: 'cups' })
  const c = customerWith(sim, [{ p: 'bread' }])
  near(sim, 'p0', -1.2, 0.2)
  assert.equal(actionFor(sim.state, SHOP, 'p0', { k: 'cu', id: c.id }).kind, 'wrong')
  assert.ok(sim.act('p0', { k: 'cu', id: c.id }).error)
  assert.ok(sim.state.players.p0.hold)
})

test('遠すぎると使えない', () => {
  const sim = mk(1)
  near(sim, 'p0', 5, 0)
  assert.equal(actionFor(sim.state, SHOP, 'p0', { k: 'st', id: 'dough' }), null)
  assert.ok(sim.act('p0', { k: 'st', id: 'dough' }).error)
})

test('ドリンクは置けば勝手にたまり、途中で取るとカップに戻る', () => {
  const sim = mk(1)
  near(sim, 'p0', 3.2, -3.4)
  sim.act('p0', { k: 'st', id: 'cups' })
  sim.act('p0', { k: 'st', id: 'drink1' })
  run(sim, 1)
  sim.act('p0', { k: 'st', id: 'drink1' })
  assert.equal(sim.state.items[sim.state.players.p0.hold].type, 'cup')
  sim.act('p0', { k: 'st', id: 'drink1' })
  run(sim, SHOP.brewSec + 0.2)
  assert.equal(sim.state.items[sim.state.stations.drink1.slots[0]].type, 'drink')
})

test('生地箱が空になったら材料の箱で補充し、材料費がかかる', () => {
  const sim = mk(1)
  atDough(sim)
  for (let i = 0; i < SHOP.doughStock.start; i++) { sim.act('p0', { k: 'st', id: 'dough' }); near(sim, 'p0', 6.3, -0.2); sim.act('p0', { k: 'st', id: 'trash' }); atDough(sim) }
  assert.equal(sim.state.stations.dough.stock, 0)
  assert.equal(actionFor(sim.state, SHOP, 'p0', { k: 'st', id: 'dough' }).none, true)
  near(sim, 'p0', 6.0, -3.4)
  assert.ok(sim.act('p0', { k: 'st', id: 'crates' }).ok)
  atDough(sim)
  assert.ok(sim.act('p0', { k: 'st', id: 'dough' }).ok)
  assert.equal(sim.state.stations.dough.stock, SHOP.doughStock.max)
  assert.equal(sim.state.stats.cost, SHOP.items.crate.cost)
})

test('待たせすぎると怒って帰る。渡した分は払っていく', () => {
  const sim = mk(1)
  const c = customerWith(sim, [{ p: 'bread' }, { p: 'drink', done: true, q: 100 }])
  c.patience = 2
  const before = sim.state.stats.sales
  run(sim, 2.2)
  assert.equal(c.st, 'angry')
  assert.equal(sim.state.stats.angry, 1)
  assert.ok(sim.state.stats.sales > before)
})

test('作業台に置いて、別の人が持てる', () => {
  const sim = mk(2)
  atDough(sim)
  sim.act('p0', { k: 'st', id: 'dough' })
  near(sim, 'p0', 0, -0.6)
  assert.ok(sim.act('p0', { k: 'st', id: 'island' }).ok)
  const it = sim.state.stations.island.slots.find(Boolean)
  near(sim, 'p1', 0.5, -0.6)
  assert.ok(sim.act('p1', { k: 'it', id: it }).ok)
  assert.equal(sim.state.players.p1.hold, it)
})

test('抜けた人が持っていた物は作業台に戻る', () => {
  const sim = mk(2)
  atDough(sim)
  sim.act('p0', { k: 'st', id: 'dough' })
  const it = sim.state.players.p0.hold
  sim.removePlayer('p0')
  assert.equal(sim.state.items[it].at[0], 'st')
  assert.ok(sim.state.players.p0.away)
})

test('位置: 壊れた値は無視し、壁と設備の中には入れない', () => {
  const sim = mk(1)
  const p = sim.state.players.p0
  const x0 = p.x
  sim.setPose('p0', { x: NaN, z: 0, yaw: 0, pitch: 0 })
  assert.equal(p.x, x0)
  sim.setPose('p0', { x: 0, z: -1.7, yaw: 0, pitch: 0 }) // 作業台の真ん中
  const obs = obstacles(SHOP, {})
  for (const [a, b, c, d] of obs) assert.ok(!(p.x > a && p.x < c && p.z > b && p.z < d), '設備の中にいる')
  sim.setPose('p0', { x: 0, z: 5, yaw: 0, pitch: 0 }) // 客席へは出られない
  assert.ok(p.z <= SHOP.layout.staffArea[3])
  const [cx, cz] = collide(-10, -10, obs, SHOP.layout.staffArea)
  assert.ok(cx >= SHOP.layout.staffArea[0] && cz >= SHOP.layout.staffArea[1])
})

test('時間帯が進み、閉店前は新しい客が来ない。時間で営業が終わる', () => {
  const sim = mk(2, { duration: 120 })
  const seen = new Set()
  let lastSpawn = 0
  while (!sim.isOver()) {
    sim.tick(1 / 30)
    for (const e of sim.drainEvents()) { if (e.type === 'phase') seen.add(e.phase); if (e.type === 'arrive') lastSpawn = sim.state.t }
  }
  assert.deepEqual([...seen], ['lunch', 'peak', 'close'])
  assert.ok(lastSpawn < 120 * PHASES[3].from + 0.1)
  const r = sim.result()
  assert.ok(r.customers > 0)
})

test('自動店員で通しの営業が回る。序盤は余裕、ピークは忙しい', () => {
  const sim = mk(2, { seed: 11 })
  const bots = makeBots(sim, SHOP, ['p0', 'p1'])
  const wait = [0, 0, 0, 0], n = [0, 0, 0, 0]
  while (!sim.isOver()) {
    sim.tick(1 / 30); bots.update(1 / 30); sim.drainEvents()
    wait[sim.state.phase] += sim.state.customers.filter(c => c.st === 'order' || c.st === 'queue').length; n[sim.state.phase]++
  }
  const r = sim.result()
  assert.ok(r.served >= r.customers * 0.7, JSON.stringify(r))
  assert.ok(r.quality >= 70)
  assert.ok(wait[2] / n[2] > (wait[0] / n[0]) * 3, `ピークの待ち ${wait[2] / n[2]} 序盤 ${wait[0] / n[0]}`)
})

test('人数が多いほど客が多い。1人でも回る', () => {
  const count = n => { const sim = mk(n, { seed: 5 }); while (!sim.isOver()) { sim.tick(1 / 30); sim.drainEvents() } return sim.state.stats.custN }
  const a = count(1), b = count(2), c = count(4)
  assert.ok(a < b && b < c, `${a} ${b} ${c}`)
  const sim = mk(1, { seed: 5 })
  const bots = makeBots(sim, SHOP, ['p0'])
  while (!sim.isOver()) { sim.tick(1 / 30); bots.update(1 / 30); sim.drainEvents() }
  assert.ok(sim.result().success >= 70)
})

test('出店場所で違いが出る（駅前は客が多く値段が高い）', () => {
  const sum = loc => { const sim = mk(2, { loc, seed: 9 }); while (!sim.isOver()) { sim.tick(1 / 30); sim.drainEvents() } return sim.state.stats.custN }
  assert.ok(sum('station') > sum('residential'))
  assert.ok(LOCATIONS.station.priceMul > LOCATIONS.residential.priceMul)
})

test('設備: オーブン2台目と大きい生地箱', () => {
  const sim = mk(1, { upgrades: { oven2: true, bigbox: true } })
  assert.ok(sim.state.stations.oven2)
  assert.equal(sim.state.stations.dough.max, SHOP.doughStock.maxBig)
  assert.equal(mk(1).state.stations.oven2, undefined)
})

test('不正な操作は無視される', () => {
  const sim = mk(1)
  for (const t of [null, 5, {}, { k: 'zz', id: 'oven1' }, { k: 'st', id: 5 }, { k: 'st', id: 'nope' }, { k: 'cu', id: 'nobody' }]) assert.ok(sim.act('p0', t).error)
  assert.ok(sim.act('ghost', { k: 'st', id: 'dough' }).error)
})

test('同じ種なら同じ営業になる', () => {
  const a = mk(2, { seed: 42 }), b = mk(2, { seed: 42 })
  run(a, 200); run(b, 200)
  assert.deepEqual(a.state.customers.map(c => c.order), b.state.customers.map(c => c.order))
  void SIM
})
