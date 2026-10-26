// 営業の仕組み（共通）とラーメン屋の工程の単体テスト（通信なし）
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSim, actionFor, collide, obstacles, stationDefs } from '../public/shared/sim.js'
import { SHOP, LOCATIONS, PHASES, BOIL, noodleQuality, boilLabel, lineTags } from '../public/shared/shops/ramen.js'
import { makeBots } from '../tools/bot.mjs'

const mk = (n = 1, o = {}) => createSim({ shop: SHOP, location: LOCATIONS[o.loc || 'residential'], players: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i })), duration: o.duration || 420, seed: o.seed ?? 3, upgrades: o.upgrades || {} })
const at = (sim, pid, x, z) => { const p = sim.state.players[pid]; p.x = x; p.z = z }
const run = (sim, sec) => { for (let t = 0; t < sec; t += 1 / 30) sim.tick(1 / 30) }
const go = (sim, pid, id) => { const st = sim.state.stations[id]; at(sim, pid, st.x, Math.min(0.1, st.z + 1.2)); return sim.act(pid, { k: 'st', id }) }
const held = (sim, pid = 'p0') => sim.state.items[sim.state.players[pid].hold]
function seat(sim, line, spot = 2) {
  run(sim, 0.05)
  const [x, z] = SHOP.layout.spots[spot]
  const c = { id: 'cx' + spot, st: 'order', arrived: true, x, z, yaw: Math.PI, path: [], order: [{ p: 'ramen', hard: 'normal', top: [], done: false, q: 0, ...line }], wait: 0, patience: 90, mood: 'happy', look: 0, spot, qi: null, payIdx: null, say: null, sayT: 0 }
  sim.state.customers.push(c)
  return c
}
// 1杯作る（茹で時間 sec、手順 steps）
function make(sim, sec, steps = ['negi']) {
  assert.ok(go(sim, 'p0', 'noodles').ok)
  assert.ok(go(sim, 'p0', 'boiler1').ok)
  assert.ok(go(sim, 'p0', 'bowls').ok)
  assert.ok(go(sim, 'p0', 'soup').ok)
  for (const s of steps.filter(s => s === 'tare' || s === 'abura')) assert.ok(go(sim, 'p0', s).ok)
  run(sim, sec)
  const r = go(sim, 'p0', 'boiler1'); assert.ok(r.ok, JSON.stringify(r))
  for (const s of steps.filter(s => s !== 'tare' && s !== 'abura')) assert.ok(go(sim, 'p0', s).ok, s)
  return held(sim)
}

test('麺→茹で釜→丼→スープ→盛る→ネギ→出す→食べる→器が残る→下げる→洗う→会計', () => {
  const sim = mk(1)
  const bowl = make(sim, 8)
  assert.equal(bowl.soup, true); assert.ok(bowl.noodle >= 7.2 && bowl.noodle <= 8.8); assert.deepEqual(bowl.top, ['negi'])
  const c = seat(sim, {})
  at(sim, 'p0', c.x, 0.2)
  assert.ok(sim.act('p0', { k: 'cu', id: c.id }).ok)
  assert.equal(c.order[0].q, 100)
  assert.equal(c.st, 'eat')
  run(sim, 15)
  assert.equal(c.st, 'pay')
  const dirty = sim.state.stations.counter.slots[2]
  assert.equal(sim.state.items[dirty].type, 'dirty')
  // 器が残っている席には次の客は座れない
  at(sim, 'p0', SHOP.layout.spots[2][0] - 1, 0.2)
  assert.ok(sim.act('p0', { k: 'it', id: dirty }).ok)
  assert.equal(sim.state.stations.counter.slots[2], null)
  const stock = sim.state.stations.bowls.stock
  assert.ok(go(sim, 'p0', 'sink').ok)
  run(sim, 2.6)
  assert.equal(sim.state.stations.bowls.stock, stock + 1)
  run(sim, 8)
  at(sim, 'p0', 4.6, 0.2)
  assert.ok(sim.act('p0', { k: 'st', id: 'register' }).ok)
  assert.equal(sim.state.stats.served, 1)
  assert.ok(sim.state.stats.sales >= SHOP.products.ramen.price)
})

test('手順の順番: スープより先に麺は盛れない。麺より先にトッピングはのせられない', () => {
  const sim = mk(1)
  go(sim, 'p0', 'noodles'); go(sim, 'p0', 'boiler1'); go(sim, 'p0', 'bowls')
  assert.equal(go(sim, 'p0', 'boiler1').error, 'cannot')
  assert.equal(go(sim, 'p0', 'negi').error, 'cannot')
  const st = sim.state.stations.boiler1
  at(sim, 'p0', st.x, -3.2)
  assert.equal(actionFor(sim.state, SHOP, 'p0', { k: 'st', id: 'boiler1' }).label, '先にスープを入れる')
})

test('茹で加減: 硬め・普通・柔らかめに「ちょうど」があり、放置するとのびる（渡せるが大きく減点）', () => {
  assert.equal(noodleQuality(5.8, 'kata'), 100)
  assert.equal(noodleQuality(8, 'normal'), 100)
  assert.equal(noodleQuality(10.5, 'yawa'), 100)
  assert.ok(noodleQuality(5.8, 'yawa') < 50)
  assert.ok(noodleQuality(20, 'normal') <= 20 && noodleQuality(20, 'normal') >= 5)
  assert.equal(boilLabel(16), 'のびた')
  assert.equal(boilLabel(8), '普通')
})

test('指定違いは減点だけで、客のひとことが変わる', () => {
  const sim = mk(1)
  const bowl = make(sim, 16) // のびた
  const c = seat(sim, { hard: 'kata', koi: true, top: ['ajitama'] })
  at(sim, 'p0', c.x, 0.2)
  assert.ok(sim.act('p0', { k: 'cu', id: c.id }).ok)
  assert.ok(c.order[0].q <= 20 && c.order[0].q >= 5)
  assert.equal(c.say, 'のびてる…')
  void bowl
})

test('味濃いめ・油多め・トッピングまで合っていれば満点', () => {
  const sim = mk(1)
  make(sim, 5.8, ['tare', 'abura', 'negi', 'chashu', 'ajitama'])
  const c = seat(sim, { hard: 'kata', koi: true, oil: true, top: ['chashu', 'ajitama'] })
  at(sim, 'p0', c.x, 0.2)
  sim.act('p0', { k: 'cu', id: c.id })
  assert.equal(c.order[0].q, 100)
  assert.deepEqual(lineTags(c.order[0]), ['硬め', '濃いめ', '油多め', '+チャーシュー', '+味玉'])
})

test('ネギを忘れると減点。スープだけの丼は出せない', () => {
  const sim = mk(1)
  make(sim, 8, [])
  const c = seat(sim, {})
  at(sim, 'p0', c.x, 0.2)
  sim.act('p0', { k: 'cu', id: c.id })
  assert.ok(c.order[0].q < 90 && c.order[0].q > 50)
  const s2 = mk(1)
  go(s2, 'p0', 'bowls'); go(s2, 'p0', 'soup')
  const c2 = seat(s2, {})
  at(s2, 'p0', c2.x, 0.2)
  assert.equal(actionFor(s2.state, SHOP, 'p0', { k: 'cu', id: c2.id }).label, 'まだ出せない')
})

test('ゴミ箱: 丼は中身だけ捨てて洗う器になる（丼は減らない）。麺はそのまま捨てる', () => {
  const sim = mk(1)
  go(sim, 'p0', 'bowls'); go(sim, 'p0', 'soup')
  assert.ok(go(sim, 'p0', 'trash').ok)
  assert.equal(held(sim).type, 'dirty')
  go(sim, 'p0', 'sink')
  go(sim, 'p0', 'noodles')
  go(sim, 'p0', 'trash')
  assert.equal(sim.state.players.p0.hold, null)
})

test('麺の箱が空になったら在庫から補充し、材料費がかかる。丼が無くなったら洗うまで取れない', () => {
  const sim = mk(1)
  for (let i = 0; i < 8; i++) { go(sim, 'p0', 'noodles'); go(sim, 'p0', 'trash') }
  assert.equal(sim.state.stations.noodles.stock, 0)
  at(sim, 'p0', -5.3, -2.6)
  assert.equal(actionFor(sim.state, SHOP, 'p0', { k: 'st', id: 'noodles' }).none, true)
  assert.ok(go(sim, 'p0', 'crates').ok)
  assert.ok(go(sim, 'p0', 'noodles').ok)
  assert.equal(sim.state.stations.noodles.stock, 8)
  assert.equal(sim.state.stats.cost, SHOP.items.crate.cost)
  for (let i = 0; i < 6; i++) { go(sim, 'p0', 'bowls'); go(sim, 'p0', 'trash'); go(sim, 'p0', 'sink'); if (i % 2) run(sim, 3) }
  run(sim, 3)
  assert.equal(sim.state.stations.bowls.stock, 6)
})

test('茹で釜は2口。てぼの追加で3口、2台目で2台。トッピング台は寄せると作業台の前に来る', () => {
  assert.equal(mk(1).state.stations.boiler1.slots.length, 2)
  const s = mk(1, { upgrades: { tebo: true, boiler2: true, neartop: true, bowls: true } })
  assert.equal(s.state.stations.boiler1.slots.length, 3)
  assert.ok(s.state.stations.boiler2)
  assert.ok(s.state.stations.negi.z > -1.5)
  assert.equal(s.state.stations.bowls.stock, 10)
  // 寄せた位置で設備どうしが重ならない
  const obs = obstacles(SHOP, { tebo: true, boiler2: true, neartop: true })
  for (let i = 0; i < obs.length; i++) for (let j = i + 1; j < obs.length; j++) {
    const [a, b] = [obs[i], obs[j]]
    assert.ok(!(a[0] < b[2] - 0.01 && b[0] < a[2] - 0.01 && a[1] < b[3] - 0.01 && b[1] < a[3] - 0.01), `重なる ${a} ${b}`)
  }
})

test('どの設備にも厨房から歩いて手が届く', () => {
  for (const up of [{}, { neartop: true, boiler2: true }]) {
    const obs = obstacles(SHOP, up)
    for (const d of stationDefs(SHOP, up)) {
      if (d.type === 'counter') continue
      let ok = false
      for (let x = -6.7; x <= 6.7 && !ok; x += 0.1) for (let z = -4.7; z <= 0.45 && !ok; z += 0.1) {
        const [cx, cz] = collide(x, z, obs, SHOP.layout.staffArea)
        if (Math.hypot(cx - x, cz - z) > 0.01) continue
        const sim = mk(1, { upgrades: up }); at(sim, 'p0', cx, cz)
        if (sim.state.stations[d.id] && distOk(sim, d.id)) ok = true
      }
      assert.ok(ok, `${d.id} に届かない`)
    }
  }
  function distOk(sim, id) { const st = sim.state.stations[id]; const p = sim.state.players.p0; return Math.hypot(st.x - p.x, st.z - p.z) < 2.2 }
})

test('席のカウンターの器は向かいからでないと下げられない（遠いと届かない）', () => {
  const sim = mk(1)
  const it = { id: 'd1', type: 'dirty', at: ['st', 'counter', 0] }
  sim.state.items.d1 = it; sim.state.stations.counter.slots[0] = 'd1'
  at(sim, 'p0', 3, 0.2)
  assert.equal(actionFor(sim.state, SHOP, 'p0', { k: 'it', id: 'd1' }), null)
  at(sim, 'p0', SHOP.layout.spots[0][0], 0.2)
  assert.equal(actionFor(sim.state, SHOP, 'p0', { k: 'it', id: 'd1' }).label, '下げる')
})

test('待たせすぎると怒って帰る。出した分は払っていく', () => {
  const sim = mk(1)
  const c = seat(sim, {})
  c.patience = 1
  run(sim, 1.2)
  assert.equal(c.st, 'angry')
  assert.equal(sim.state.stats.angry, 1)
})

test('時間帯ごとに注文の難しさが1段ずつ増える', () => {
  const sim = mk(4, { duration: 600, loc: 'residential' })
  const seen = {}
  while (!sim.isOver()) {
    sim.tick(1 / 30)
    for (const e of sim.drainEvents()) if (e.type === 'arrive') {
      const c = sim.state.customers.find(c => c.id === e.id); if (!c) continue
      const l = c.order[0], ph = PHASES[sim.state.phase].id
      seen[ph] = seen[ph] || { hard: 0, flags: 0, top: 0, n: 0 }
      seen[ph].n++; if (l.hard !== 'normal') seen[ph].hard++; if (l.koi || l.oil) seen[ph].flags++; if (l.top.length) seen[ph].top++
    }
  }
  assert.deepEqual([seen.open.hard, seen.open.flags, seen.open.top], [0, 0, 0])
  assert.ok(seen.hard.hard > 0 && seen.hard.flags === 0 && seen.hard.top === 0)
  assert.ok(seen.flags.flags > 0 && seen.flags.top === 0)
  assert.ok(seen.peak.top > 0)
})

test('自動店員で通しの営業が回る。序盤は余裕、ピークは忙しい', () => {
  for (const [n, loc] of [[1, 'residential'], [2, 'residential'], [2, 'station'], [4, 'station']]) {
    const sim = mk(n, { seed: 11, loc })
    const bots = makeBots(sim, SHOP, Object.keys(sim.state.players))
    const wait = [0, 0, 0, 0, 0], k = [0, 0, 0, 0, 0]
    while (!sim.isOver()) { sim.tick(1 / 30); bots.update(1 / 30); sim.drainEvents(); wait[sim.state.phase] += sim.state.customers.filter(c => c.st === 'order' || c.st === 'queue').length; k[sim.state.phase]++ }
    const r = sim.result()
    assert.ok(r.success >= 60, `${n}人 ${loc}: ${JSON.stringify(r)}`)
    assert.ok(r.quality >= 80)
    assert.ok(wait[3] / k[3] > (wait[0] / k[0]) * 2, `${n}人 ${loc}: ピーク ${wait[3] / k[3]} 序盤 ${wait[0] / k[0]}`)
  }
})

test('人数が多いほど客が多い。駅前は住宅街より多い', () => {
  const count = (n, loc = 'residential') => { const sim = mk(n, { seed: 5, loc }); while (!sim.isOver()) { sim.tick(1 / 30); sim.drainEvents() } return sim.state.stats.custN }
  assert.ok(count(1) < count(2) && count(2) < count(4))
  assert.ok(count(2, 'station') > count(2))
})

test('作業台に置いて別の人が持てる。抜けた人の持ち物は作業台に戻る', () => {
  const sim = mk(2)
  go(sim, 'p0', 'bowls'); go(sim, 'p0', 'island')
  const it = sim.state.stations.island.slots.find(Boolean)
  at(sim, 'p1', 0.5, -0.6)
  assert.ok(sim.act('p1', { k: 'it', id: it }).ok)
  sim.removePlayer('p1')
  assert.equal(sim.state.items[it].at[0], 'st')
})

test('不正な操作と位置は無視される', () => {
  const sim = mk(1)
  for (const t of [null, 5, {}, { k: 'zz', id: 'soup' }, { k: 'st', id: 5 }, { k: 'st', id: 'nope' }, { k: 'cu', id: 'x' }, { k: 'it', id: 'x' }]) assert.ok(sim.act('p0', t).error)
  assert.ok(sim.act('ghost', { k: 'st', id: 'noodles' }).error)
  const p = sim.state.players.p0, x0 = p.x
  sim.setPose('p0', { x: NaN, z: 0, yaw: 0, pitch: 0 }); assert.equal(p.x, x0)
  sim.setPose('p0', { x: 0, z: 5, yaw: 0, pitch: 0 }); assert.ok(p.z <= SHOP.layout.staffArea[3])
})

test('同じ種なら同じ営業になる', () => {
  const a = mk(2, { seed: 42 }), b = mk(2, { seed: 42 })
  run(a, 200); run(b, 200)
  assert.deepEqual(a.state.customers.map(c => c.order), b.state.customers.map(c => c.order))
  void BOIL
})
