// 部屋の管理（ロビー・開始・途中参加・切断・不正な入力）と、本物の WebSocket サーバーの通しテスト
import test from 'node:test'
import assert from 'node:assert/strict'
import WebSocket from 'ws'
import { Rooms, ROOM } from '../public/shared/rooms.js'
import { SHOP } from '../public/shared/shops/ramen.js'
import { startServer } from '../server.mjs'

function setup() {
  let t = 0
  const box = new Map()
  const rooms = new Rooms({ shop: SHOP, now: () => t, send: (id, m) => { if (!box.has(id)) box.set(id, []); box.get(id).push(m) } })
  const s = () => { const id = rooms.newSession().id; rooms.hello(id); return id }
  const last = (id, type) => [...(box.get(id) || [])].reverse().find(m => m.t === type)
  return { rooms, s, last, box, adv: ms => { t += ms; rooms.tick(ms) } }
}

test('作成→参加→開始。ホストだけが始められ、4人で満員', () => {
  const { rooms, s, last } = setup()
  const a = s(), b = s()
  rooms.handle(a, { t: 'create', name: 'A', opts: { location: 'station' } })
  const code = last(a, 'joined').code
  rooms.handle(b, { t: 'join', code: code.toLowerCase(), name: 'B' })
  assert.equal(last(b, 'room').players.length, 2)
  rooms.handle(b, { t: 'start' })
  assert.equal(last(b, 'error').code, 'not_host')
  for (const n of ['C', 'D']) { const x = s(); rooms.handle(x, { t: 'join', code, name: n }) }
  const e = s(); rooms.handle(e, { t: 'join', code, name: 'E' })
  assert.equal(last(e, 'error').code, 'full')
  rooms.handle(a, { t: 'start', opts: { location: 'station' } })
  assert.equal(last(a, 'room').phase, 'playing')
  assert.equal(last(a, 'room').opts.location, 'station')
  assert.equal(ROOM.max, 4)
})

test('1人でも始められ、営業が終わると結果が全員に届く', () => {
  const { rooms, s, last, adv } = setup()
  const a = s()
  rooms.handle(a, { t: 'create', name: 'A' })
  rooms.handle(a, { t: 'start', opts: { duration: 30 } })
  for (let i = 0; i < 40 * 30; i++) adv(1000 / 30)
  const r = last(a, 'room')
  assert.equal(r.phase, 'result')
  assert.ok(r.result && typeof r.result.profit === 'number')
  assert.ok(last(a, 'snap'))
})

test('開始の設定は検証する（知らない設備・場所・極端な時間は捨てる）', () => {
  const { rooms, s, last } = setup()
  const a = s()
  rooms.handle(a, { t: 'create', name: 'A' })
  rooms.handle(a, { t: 'start', opts: { location: 'moon', upgrades: { boiler2: true, hack: true, shoes: 'yes' }, duration: 1 } })
  const o = last(a, 'room').opts
  assert.equal(o.location, 'residential')
  assert.deepEqual(o.upgrades, { boiler2: true })
  assert.equal(o.duration, 30)
})

test('営業中に途中参加できる。切断しても猶予の間は戻れる', () => {
  const { rooms, s, last, adv } = setup()
  const a = s(), b = s()
  rooms.handle(a, { t: 'create', name: 'A' })
  const code = last(a, 'joined').code
  rooms.handle(a, { t: 'start' })
  rooms.handle(b, { t: 'join', code, name: 'B' })
  adv(100)
  assert.ok(last(b, 'snap').s.players[b])
  rooms.disconnect(a)
  adv(ROOM.graceMs / 2)
  rooms.hello(a)
  assert.equal(last(a, 'welcome').code, code)
  rooms.disconnect(b)
  adv(ROOM.graceMs + 100)
  assert.equal(last(a, 'room').players.length, 1)
})

test('ホストが抜けると次の人がホストになる', () => {
  const { rooms, s, last } = setup()
  const a = s(), b = s()
  rooms.handle(a, { t: 'create', name: 'A' })
  rooms.handle(b, { t: 'join', code: last(a, 'joined').code, name: 'B' })
  rooms.handle(a, { t: 'leave' })
  assert.equal(last(b, 'room').host, b)
})

test('名前は空・制御文字を拒む', () => {
  const { rooms, s, last } = setup()
  const a = s()
  rooms.handle(a, { t: 'create', name: '  \u0001 ' })
  assert.equal(last(a, 'error').code, 'bad_name')
  rooms.handle(a, { t: 'create', name: '<b>あいうえおかきくけこさしすせそ' })
  assert.equal(last(a, 'room').players[0].name, 'bあいうえおかきくけこさ')
})

test('本物のサーバーで2人つないで、作成→参加→開始→操作→状態の同期', async () => {
  const srv = await startServer({ port: 0, quiet: true })
  const open = () => new Promise(res => {
    const ws = new WebSocket(`ws://localhost:${srv.port}/ws`)
    const msgs = []
    ws.on('message', d => msgs.push(JSON.parse(d)))
    ws.on('error', () => {})
    ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello' })); res({ ws, msgs, send: m => ws.send(JSON.stringify(m)) }) })
  })
  const wait = async (c, f, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = [...c.msgs].reverse().find(f); if (m) return m; await new Promise(r => setTimeout(r, 20)) } throw new Error('timeout') }
  const A = await open(), B = await open()
  const wa = await wait(A, m => m.t === 'welcome')
  A.send({ t: 'create', name: 'A' })
  const { code } = await wait(A, m => m.t === 'joined')
  B.send({ t: 'join', code, name: 'B' })
  await wait(A, m => m.t === 'room' && m.players.length === 2)
  A.send({ t: 'start' })
  await wait(B, m => m.t === 'snap')
  // A が生地箱の前に立って生地を取る → B の画面に A が持っている状態が届く
  A.send({ t: 'pose', p: { x: -5.3, z: -2.6, yaw: -Math.PI / 2, pitch: 0 } })
  await new Promise(r => setTimeout(r, 150))
  A.send({ t: 'act', target: { k: 'st', id: 'noodles' }, seq: 1 })
  const r = await wait(A, m => m.t === 'actr' && m.seq === 1)
  assert.ok(r.ok, JSON.stringify(r))
  const snap = await wait(B, m => m.t === 'snap' && m.s.players[wa.id]?.hold)
  assert.equal(snap.s.items[snap.s.players[wa.id].hold].type, 'noodle')
  // 壊れた JSON と大きすぎる送信でサーバーが落ちない
  A.ws.send('{oops')
  A.send({ t: 'act', target: { k: 'st', id: 'x'.repeat(5000) } })
  const res = await fetch(`http://localhost:${srv.port}/healthz`).then(r => r.json())
  assert.equal(res.ok, true)
  const html = await fetch(`http://localhost:${srv.port}/r/${code}`).then(r => r.text())
  assert.ok(html.includes(`content="http://localhost:${srv.port}/og.png"`))
  const bad = await fetch(`http://localhost:${srv.port}/..%2f..%2fpackage.json`)
  assert.notEqual(bad.status, 200)
  A.ws.close(); B.ws.close()
  await srv.close()
})
