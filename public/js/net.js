// 通信の口。online() は WebSocket でサーバーへ、local() はブラウザの中の部屋へつなぐ。どちらも send と onMessage だけ。
import { Rooms } from '../shared/rooms.js'
import { SHOP } from '../shared/shops/ramen.js'
const KEY = 'shop-session'

export function online({ onMessage, onStatus }) {
  let ws = null, retry = 0, closed = false
  const queue = []
  const saved = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null') } catch { return null } }
  function open() {
    if (closed) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/ws`)
    onStatus('connecting')
    ws.onopen = () => {
      retry = 0
      const s = saved()
      ws.send(JSON.stringify({ t: 'hello', id: s?.id, token: s?.token }))
      onStatus('online')
      while (queue.length) ws.send(queue.shift())
    }
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data) } catch { return }
      if (m.t === 'session') { try { sessionStorage.setItem(KEY, JSON.stringify({ id: m.id, token: m.token })) } catch {} }
      onMessage(m)
    }
    ws.onclose = () => { if (closed) return; onStatus('offline'); setTimeout(open, Math.min(8000, 500 * 2 ** retry++)) }
    ws.onerror = () => {}
  }
  open()
  const ping = setInterval(() => send({ t: 'ping', at: performance.now() }), 4000)
  function send(m) {
    const s = JSON.stringify(m)
    if (ws && ws.readyState === 1) ws.send(s)
    else if (m.t !== 'pose' && m.t !== 'ping' && m.t !== 'act') queue.push(s)
  }
  return { kind: 'online', send, close() { closed = true; clearInterval(ping); ws?.close() } }
}

// ひとりで営業: サーバーと同じ部屋の仕組みをブラウザで動かす（通信なし）。届く形もサーバーと同じ（JSON を通す）
export function local({ onMessage, onStatus }) {
  let rooms
  const deliver = (_id, m) => { const s = JSON.stringify(m); queueMicrotask(() => onMessage(JSON.parse(s))) }
  rooms = new Rooms({ shop: SHOP, send: deliver })
  const me = rooms.newSession().id
  let last = performance.now(), paused = false
  // ひとりのときはメニューを開くと営業の時間も止まる
  const loop = setInterval(() => { const t = performance.now(); if (!paused) rooms.tick(Math.min(250, t - last)); last = t }, 1000 / 30)
  onStatus('local')
  queueMicrotask(() => rooms.hello(me))
  return {
    kind: 'local',
    send(m) {
      const c = JSON.parse(JSON.stringify(m))
      if (c.t === 'hello') return
      if (c.t === '_pause') { paused = !!c.v; return }
      queueMicrotask(() => rooms.handle(me, c))
    },
    close() { clearInterval(loop) }
  }
}
