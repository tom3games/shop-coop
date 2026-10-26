// 部屋（ロビー → 営業 → 結果）の管理。サーバーはこれを WebSocket の先で動かし、
// 「ひとりで営業」はブラウザの中で同じものを動かす（通信の代わりに関数を呼ぶだけ）。どちらも同じ規則になる。
//
// 画面 → 部屋: hello / create / join / leave / start / pose / act / lobby / ping
// 部屋 → 画面: session / welcome / room（部屋の状態）/ snap（営業の状態 15回/秒）/ actr（操作の結果）/ error

import { createSim } from './sim.js'

export const ROOM = {
  min: 1, max: 4,
  snapHz: 15,
  graceMs: 30_000,     // 切断してからこの時間は席を残す（つなぎ直せば戻れる）
  idleMs: 30 * 60_000, // 誰も何もしない部屋は閉じる
  nameMax: 12
}
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 見間違えやすい I O 0 1 を除く

export function cleanName(n) {
  return String(n ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, ROOM.nameMax)
}

export class Rooms {
  constructor({ send, now = () => Date.now(), shop, rand = Math.random }) {
    Object.assign(this, { send, now, shop, locations: shop.locations, upgradeDefs: shop.upgrades, rand })
    this.sessions = new Map() // id -> { token, code }
    this.rooms = new Map()
  }

  _id(n) { let s = ''; for (let i = 0; i < n; i++) s += 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(this.rand() * 32)]; return s }
  newSession() { const id = 's' + this._id(10), token = this._id(20); this.sessions.set(id, { token, code: null }); return { id, token } }
  resume(id, token) { const s = this.sessions.get(id); return !!(s && s.token === token) }

  // つないだ直後。前の部屋に戻れるなら戻す
  hello(sid) {
    const s = this.sessions.get(sid)
    const room = s?.code && this.rooms.get(s.code)
    const p = room && room.players.find(p => p.id === sid)
    if (p) { p.connected = true; p.leftAt = null; if (room.sim) room.sim.addPlayer(sid, p.name) }
    this.send(sid, { t: 'welcome', id: sid, code: p ? room.code : null })
    if (p) this.broadcast(room)
  }

  handle(sid, msg) {
    if (!msg || typeof msg.t !== 'string') return this.err(sid, 'bad_msg')
    const room = this._roomOf(sid)
    if (room) room.lastActive = this.now()
    switch (msg.t) {
      case 'create': return this.create(sid, msg.name, msg.opts)
      case 'join': return this.join(sid, msg.code, msg.name)
      case 'leave': return this.leave(sid)
      case 'start': return this.start(sid, msg.opts)
      case 'lobby': return this.toLobby(sid)
      case 'pose': if (room?.sim && room.phase === 'playing') room.sim.setPose(sid, msg.p); return
      case 'act': {
        if (!room?.sim || room.phase !== 'playing') return this.err(sid, 'not_playing')
        const r = room.sim.act(sid, msg.target)
        this.send(sid, { t: 'actr', seq: msg.seq, ...r })
        return
      }
      case 'ping': return this.send(sid, { t: 'pong', at: msg.at })
      default: return this.err(sid, 'unknown')
    }
  }

  err(sid, code, extra = {}) { this.send(sid, { t: 'error', code, ...extra }) }

  _opts(o) {
    o = o && typeof o === 'object' ? o : {}
    const loc = Object.hasOwn(this.locations, o.location) ? o.location : Object.keys(this.locations)[0]
    const up = {}
    if (o.upgrades && typeof o.upgrades === 'object') for (const k of Object.keys(this.upgradeDefs)) if (o.upgrades[k] === true) up[k] = true
    let duration = Number(o.duration)
    duration = Number.isFinite(duration) ? Math.max(30, Math.min(900, Math.round(duration))) : 420
    return { location: loc, upgrades: up, duration }
  }

  create(sid, name, opts) {
    const n = cleanName(name)
    if (!n) return this.err(sid, 'bad_name')
    this.leave(sid, true)
    let code
    do { code = ''; for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(this.rand() * CODE_CHARS.length)] } while (this.rooms.has(code))
    const room = { code, host: sid, players: [{ id: sid, name: n, connected: true }], phase: 'lobby', opts: this._opts(opts), sim: null, result: null, round: 0, lastActive: this.now(), snapAcc: 0 }
    this.rooms.set(code, room)
    this.sessions.get(sid).code = code
    this.send(sid, { t: 'joined', code })
    this.broadcast(room)
  }

  join(sid, code, name) {
    const n = cleanName(name)
    if (!n) return this.err(sid, 'bad_name')
    const room = this.rooms.get(String(code || '').toUpperCase())
    if (!room) return this.err(sid, 'not_found')
    const back = room.players.find(p => p.id === sid)
    if (!back) {
      if (room.players.length >= ROOM.max) return this.err(sid, 'full')
      this.leave(sid, true)
      room.players.push({ id: sid, name: n, connected: true })
    } else back.connected = true
    this.sessions.get(sid).code = room.code
    // 営業中でも途中から入れる（客の数は人数に合わせて増える）
    if (room.sim) room.sim.addPlayer(sid, n)
    this.send(sid, { t: 'joined', code: room.code })
    this.broadcast(room)
  }

  leave(sid, quiet) {
    const room = this._roomOf(sid)
    const s = this.sessions.get(sid)
    if (s) s.code = null
    if (!room) return
    room.players = room.players.filter(p => p.id !== sid)
    if (room.sim) room.sim.removePlayer(sid)
    if (!room.players.length) { this.rooms.delete(room.code); return }
    if (room.host === sid) room.host = room.players[0].id
    this.broadcast(room)
  }

  start(sid, opts) {
    const room = this._roomOf(sid)
    if (!room) return this.err(sid, 'no_room')
    if (room.host !== sid) return this.err(sid, 'not_host')
    if (room.phase === 'playing') return this.err(sid, 'started')
    room.opts = this._opts(opts)
    const players = room.players.filter(p => p.connected)
    room.round++
    room.sim = createSim({
      shop: this.shop, location: this.locations[room.opts.location], players: players.map(p => ({ id: p.id, name: p.name })),
      upgrades: room.opts.upgrades, duration: room.opts.duration, seed: Math.floor(this.rand() * 2 ** 31)
    })
    room.phase = 'playing'
    room.result = null
    room.snapAcc = 1
    this.broadcast(room)
  }

  toLobby(sid) {
    const room = this._roomOf(sid)
    if (!room || room.host !== sid || room.phase === 'playing') return
    room.phase = 'lobby'; room.sim = null
    this.broadcast(room)
  }

  disconnect(sid) {
    const room = this._roomOf(sid)
    const p = room && room.players.find(p => p.id === sid)
    if (!p) return
    p.connected = false; p.leftAt = this.now()
    this.broadcast(room)
  }

  tick(dtMs) {
    const now = this.now()
    for (const room of [...this.rooms.values()]) {
      for (const p of [...room.players]) if (!p.connected && now - p.leftAt > ROOM.graceMs) this.leave(p.id)
      if (!this.rooms.has(room.code)) continue
      if (room.host && !room.players.find(p => p.id === room.host)?.connected) {
        const next = room.players.find(p => p.connected)
        if (next) { room.host = next.id; this.broadcast(room) }
      }
      if (now - room.lastActive > ROOM.idleMs) { for (const p of room.players) { this.send(p.id, { t: 'closed' }); const s = this.sessions.get(p.id); if (s) s.code = null } this.rooms.delete(room.code); continue }
      if (room.phase !== 'playing' || !room.sim) continue
      room.sim.tick(dtMs / 1000)
      room.snapAcc += dtMs / 1000
      const over = room.sim.isOver()
      if (room.snapAcc >= 1 / ROOM.snapHz || over) {
        room.snapAcc = 0
        const ev = room.sim.drainEvents()
        for (const p of room.players) if (p.connected) this.send(p.id, { t: 'snap', round: room.round, s: room.sim.state, ev })
      }
      if (over) {
        room.result = room.sim.result()
        room.phase = 'result'
        this.broadcast(room)
      }
    }
  }

  _roomOf(sid) { const s = this.sessions.get(sid); return s?.code ? this.rooms.get(s.code) : null }

  broadcast(room) {
    const base = {
      t: 'room', code: room.code, phase: room.phase, host: room.host, round: room.round, opts: room.opts,
      players: room.players.map(p => ({ id: p.id, name: p.name, connected: p.connected })), max: ROOM.max, result: room.result
    }
    for (const p of room.players) if (p.connected) this.send(p.id, { ...base, you: p.id })
  }
}
