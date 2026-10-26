// 仮の店（一人称の協力店舗ゲーム）のサーバー。画面（public/）と WebSocket（/ws）を同じポートで出す。
// 起動: node server.mjs   （PORT=8110 node server.mjs でポート変更）
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'
import { Rooms } from './public/shared/rooms.js'
import { SHOP, LOCATIONS, PHASES, UPGRADES } from './public/shared/shops/prototype.js'

const ROOT = fileURLToPath(new URL('./public/', import.meta.url))
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' }
const MAX_MSG = 4096
const MAX_PER_SEC = 60 // 1接続あたりの送信の上限（位置 20回/秒 + 操作）

export function startServer({ port = Number(process.env.PORT) || 8110, quiet = false } = {}) {
  const sockets = new Map()
  const rooms = new Rooms({
    shop: SHOP, locations: LOCATIONS, phases: PHASES, upgrades: UPGRADES,
    send: (id, msg) => { const ws = sockets.get(id); if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)) }
  })

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ ok: true, rooms: rooms.rooms.size, sessions: sockets.size }))
    }
    const path = url.pathname === '/' || url.pathname.startsWith('/r/') ? '/index.html' : url.pathname
    let file
    try { file = normalize(join(ROOT, decodeURIComponent(path))) } catch { res.writeHead(400); return res.end() }
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end() }
    try {
      let body = await readFile(file)
      if (file.endsWith('index.html')) {
        // SNS のカードは og:image を絶対URLでしか読まないものがあるので、届いたホスト名で書き換える
        const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').replace(/[^a-zA-Z0-9.:-]/g, '')
        const proto = req.headers['x-forwarded-proto'] === 'https' || /trycloudflare\.com$/.test(host) ? 'https' : 'http'
        if (host) body = Buffer.from(body.toString('utf8').replaceAll('content="/og.png"', `content="${proto}://${host}/og.png"`))
      }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' })
      res.end(body)
    } catch { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found') }
  })

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MSG })
  wss.on('connection', ws => {
    let sid = null
    let tokens = MAX_PER_SEC, last = Date.now()
    ws.isAlive = true
    ws.on('pong', () => { ws.isAlive = true })
    ws.on('error', () => {}) // 大きすぎる送信などは接続を切るだけ（サーバーは落とさない）
    ws.on('message', raw => {
      let msg
      try { msg = JSON.parse(raw) } catch { return }
      if (!msg || typeof msg.t !== 'string') return
      if (msg.t === 'hello') {
        if (msg.id && msg.token && rooms.resume(msg.id, msg.token)) sid = msg.id
        else { const s = rooms.newSession(); sid = s.id; ws.send(JSON.stringify({ t: 'session', id: s.id, token: s.token })) }
        const old = sockets.get(sid); if (old && old !== ws) old.close(4000, 'replaced')
        sockets.set(sid, ws)
        return rooms.hello(sid)
      }
      if (!sid) return
      if (msg.t === 'pose' || msg.t === 'act') {
        const now = Date.now()
        tokens = Math.min(MAX_PER_SEC, tokens + (now - last) * MAX_PER_SEC / 1000); last = now
        if (tokens < 1) return // 送りすぎた操作だけ捨てる（部屋の操作は捨てない）
        tokens -= 1
      }
      rooms.handle(sid, msg)
    })
    ws.on('close', () => { if (sid && sockets.get(sid) === ws) { sockets.delete(sid); rooms.disconnect(sid) } })
  })
  const hb = setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue } ws.isAlive = false; ws.ping() } }, 15_000)
  let lastT = Date.now()
  const loop = setInterval(() => { const t = Date.now(); rooms.tick(t - lastT); lastT = t }, 1000 / 30)

  return new Promise(resolve => server.listen(port, () => {
    if (!quiet) console.log(`仮の店: http://localhost:${server.address().port}`)
    resolve({ port: server.address().port, rooms, close: () => new Promise(r => { clearInterval(hb); clearInterval(loop); for (const ws of wss.clients) ws.terminate(); wss.close(); server.close(() => r()) }) })
  }))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) startServer()
