// 営業中の画面。一人称で歩き、照準の先の物を「使う」。部屋（サーバーかブラウザ内）から届く状態を描く。
// 自分の位置はこの画面で動かして送る（遅れなく歩ける）。客と他の店員は届いた状態を少し遅らせて補間する。
import * as THREE from '../vendor/three.module.js'
import { SIM, actionFor, obstacles, collide, stationSize, stationDefs } from '../shared/sim.js'
import { SHOP, PHASES } from '../shared/shops/ramen.js'
import { buildShop, personMesh, setMood, makeBubble, textPlane } from './world.js'
import * as V from './shops/ramen-view.js'
import { createInput } from './input.js'
import { sfx, bgm } from './audio.js'

const $ = s => document.querySelector(s)
const INTERP = 0.11
const POSE_HZ = 20
const ICONS = {
  take: '<svg viewBox="0 0 24 24"><path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V11m0-1V4.5a1.5 1.5 0 0 1 3 0V10m0 0V5.5a1.5 1.5 0 0 1 3 0V11m0-2.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7L3.5 14a1.6 1.6 0 0 1 2.6-1.8L7 13.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  put: '<svg viewBox="0 0 24 24"><path d="M12 4v10m-4-4 4 4 4-4M4 19h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  serve: '<svg viewBox="0 0 24 24"><path d="M3 15h13l4-4M3 19h18M8 15a4 4 0 0 1 8 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pay: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="13" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 4h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  refill: '<svg viewBox="0 0 24 24"><path d="M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11v6M12 7.5v.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>'
}
ICONS.pour = '<svg viewBox="0 0 24 24"><path d="M4 6h9l-1 3H5zM12 9c3 0 4 3 4 6M16 15v5M5 13h14l-2 7H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
ICONS.top = '<svg viewBox="0 0 24 24"><path d="M4 14h16l-2 6H6zM8 10c0-2 1-3 2-3M12 10c0-3 1-4 3-4M16 10c0-1.5 .5-2.5 1.5-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const KIND_ICON = { take: 'take', put: 'put', serve: 'serve', pay: 'pay', refill: 'refill', trash: 'trash', pour: 'pour', top: 'top' }
const PHASE_NEWS = Object.fromEntries(PHASES.map(p => [p.id, p.news]))

export function createGame({ quality, onLeave }) {
  const canvas = $('#cv')
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !quality.low, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality.low ? 1.25 : 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = !!quality.shadows
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  let G = null // 1回の営業ぶんの状態
  const input = createInput(canvas, { onUse: () => G && use(), onMenu: () => G && toggleMenu(), isActive: () => !!G && !G.menu })

  function start({ room, you, send, solo, hints }) {
    stop()
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xbfd8e8)
    scene.fog = new THREE.Fog(0xbfd8e8, 18, 40)
    const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 60)
    camera.rotation.order = 'YXZ'
    scene.add(camera)
    const ups = room.opts.upgrades || {}
    const shop = buildShop(scene, SHOP, ups, quality, V)
    const hl = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true }))
    hl.renderOrder = 9; hl.visible = false; scene.add(hl)
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 12), new THREE.MeshBasicMaterial({ color: 0xffd23f, depthTest: false }))
    arrow.rotation.x = Math.PI; arrow.renderOrder = 9; arrow.visible = false; scene.add(arrow)
    const hand = new THREE.Group(); hand.position.set(0.24, -0.3, -0.75); hand.scale.setScalar(0.62); camera.add(hand)
    const defs = Object.fromEntries(stationDefs(SHOP, ups).map(d => [d.id, d]))
    // 食べている客の前に置く丼（見た目だけ）
    const eatBowls = SHOP.layout.spots.map(([x]) => { const b = V.itemMesh('bowl'); V.paintItem(b, { type: 'bowl', soup: true, noodle: 8, top: ['negi', 'chashu'] }); b.position.set(x, 1.01, 1.25); b.visible = false; scene.add(b); return b })
    G = {
      scene, camera, shop, hl, arrow, hand, defs, eatBowls, send, solo, you, room, hints,
      obs: obstacles(SHOP, ups), area: SHOP.layout.staffArea, speedMul: ups.shoes ? SIM.shoesMul : 1,
      snaps: [], s: null, me: null, poseAcc: 0, items: new Map(), custs: new Map(), staff: new Map(), handItem: null,
      target: null, action: null, seq: 0, lastT: performance.now(), hudAcc: 1, feed: [], menu: false, stepAcc: 0,
      orderKey: '', phaseSeen: 0
    }
    input.reset()
    $('#hud').hidden = false
    $('#menu').hidden = true
    $('#banner').hidden = true
    $('#feed').replaceChildren()
    bgm(true, 0)
    resize()
    showBanner('開店', PHASES[0].news, 2600)
    G.raf = requestAnimationFrame(frame)
    // e2e 用の窓口
    window.__shop = {
      state: () => G && G.s, me: () => G && G.me, you: () => G && G.you, target: () => G && G.target, action: () => G && G.action,
      // 指定した物の正面へ歩かずに移動して、照準を合わせる（テストだけが使う）
      aimAt: (k, id) => aimAt(k, id), use: () => use()
    }
  }

  function stop() {
    if (!G) return
    cancelAnimationFrame(G.raf)
    G.scene.traverse(o => { o.geometry?.dispose?.(); if (o.material) { for (const m of [].concat(o.material)) { m.map?.dispose?.(); m.dispose?.() } } })
    input.unlock()
    bgm(false)
    G = null
    $('#hud').hidden = true
  }

  function resize() {
    if (!G) return
    const w = innerWidth, h = innerHeight
    renderer.setSize(w, h, false)
    G.camera.aspect = w / h
    const hf = 96 * Math.PI / 180
    G.camera.fov = Math.max(52, Math.min(80, 2 * Math.atan(Math.tan(hf / 2) / G.camera.aspect) * 180 / Math.PI))
    G.camera.updateProjectionMatrix()
  }
  addEventListener('resize', resize)

  // ---- 届いた状態
  function onSnap(m) {
    if (!G || m.round !== G.room.round) return
    G.snaps.push({ at: performance.now() / 1000, s: m.s })
    if (G.snaps.length > 20) G.snaps.shift()
    G.s = m.s
    if (!G.me && m.s.players[G.you]) { const p = m.s.players[G.you]; G.me = { x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch } }
    for (const e of m.ev) onEvent(e)
  }
  function onActr(m) { if (G && m.error) sfx.nope() }

  function onEvent(e) {
    const s = G.s
    const mine = e.by === G.you
    switch (e.type) {
      case 'order': sfx.order(); break
      case 'boiled': if (e.kind === 'normal') sfx.boiled(); else sfx.tick(); break
      case 'nobi': sfx.burnt(); break
      case 'plate': sfx.plate(); break
      case 'pour': if (mine) sfx.pour(); break
      case 'flavor': if (mine) sfx.drip(); break
      case 'top': if (mine) sfx.chop(); break
      case 'washed': sfx.clink(); break
      case 'take': if (mine) sfx.pick(); break
      case 'put': if (mine) sfx.put(); break
      case 'refill': sfx.refill(); break
      case 'trash': if (mine) sfx.trash(); break
      case 'serve': sfx.serve(e.q); feed(`${who(e.by)}が出した（${e.q}点）`, e.q >= 80 ? 'good' : e.q < 50 ? 'warn' : ''); break
      case 'pay': sfx.pay(); feed(e.auto ? `自分で払って帰った +¥${e.amount}` : `会計 +¥${e.amount}${e.tip ? `（心づけ¥${e.tip}）` : ''}`, e.auto ? 'warn' : 'good'); break
      case 'angry': sfx.angry(); feed('待ちきれず帰った', 'bad'); break
      case 'impatient': if (e.mood === 'angry') sfx.impatient(); break
      case 'turned': feed('満席で入れなかった', 'bad'); break
      case 'stockout': case 'nobowl': sfx.impatient(); break
      case 'arrive': sfx.door(); break
      case 'phase': sfx.phase(); showBanner(e.name, PHASE_NEWS[e.phase] || '', 3400); break
      case 'close': sfx.close(); break
    }
    const f = V.feedFor(e, who)
    if (f) feed(f[0], f[1])
    void s
  }
  const who = id => id === G.you ? 'あなた' : (G.s?.players[id]?.name || '仲間')

  function feed(text, kind = '') {
    const el = document.createElement('div')
    el.className = 'feed-item ' + kind
    el.textContent = text
    const box = $('#feed')
    box.prepend(el)
    while (box.children.length > 4) box.lastChild.remove()
    setTimeout(() => el.classList.add('out'), 3600)
    setTimeout(() => el.remove(), 4200)
  }
  let bannerT = 0
  function showBanner(title, sub, ms) {
    const b = $('#banner')
    b.innerHTML = `<b></b><span></span>`
    b.querySelector('b').textContent = title; b.querySelector('span').textContent = sub
    b.hidden = false
    clearTimeout(bannerT); bannerT = setTimeout(() => (b.hidden = true), ms)
  }

  // ---- 操作
  function use() {
    if (!G || G.menu || !G.target) return
    if (!G.action || G.action.none) { sfx.nope(); return }
    sfx.click()
    G.send({ t: 'act', target: { k: G.target.k, id: G.target.id }, seq: ++G.seq })
  }
  function toggleMenu(force) {
    G.menu = force ?? !G.menu
    $('#menu').hidden = !G.menu
    if (G.menu) input.unlock()
    if (G.solo) G.send({ t: '_pause', v: G.menu })
  }
  $('#menuBtn').onclick = () => G && toggleMenu()
  $('#resumeBtn').onclick = () => G && toggleMenu(false)
  $('#quitBtn').onclick = () => {
    const b = $('#quitBtn')
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'もう一度押すと店を出る'; setTimeout(() => { b.dataset.armed = ''; b.textContent = '店を出る' }, 2500); return }
    b.dataset.armed = ''; b.textContent = '店を出る'
    onLeave()
  }

  function aimAt(k, id) {
    const s = G.s
    let x, z, y
    if (k === 'cu') { const c = s.customers.find(c => c.id === id); if (!c) return false; x = c.x; z = c.z; y = 1.3 }
    else {
      const sid = k === 'it' ? s.items[id]?.at[1] : id
      const st = s.stations[sid]; if (!st) return false
      ;[x, z] = [st.x, st.z]; y = 0.95
      if (k === 'it') { const p = itemWorld(s.items[id]); if (p) { x = p.x; y = p.y; z = p.z } }
    }
    // 立つ場所: 物から厨房の内側へ 1.1m
    const sx = Math.max(G.area[0] + 0.4, Math.min(G.area[2] - 0.4, x))
    const sz = Math.max(G.area[1] + 0.4, Math.min(G.area[3] - 0.4, z > 0 ? 0.15 : z + (z < -3 ? 1.6 : -1.25)))
    let [cx, cz] = collide(sx, sz, G.obs, G.area)
    if (k !== 'cu' && Math.abs(z - (-1.7)) < 0.8) { [cx, cz] = collide(x, -0.35, G.obs, G.area) }
    G.me.x = cx; G.me.z = cz
    const dx = x - cx, dz = z - cz
    G.me.yaw = Math.atan2(dx, dz)
    G.me.pitch = Math.atan2(y - 1.6, Math.hypot(dx, dz))
    return true
  }

  // ---- 位置の計算
  const tmpV = new THREE.Vector3()
  function itemWorld(it) {
    if (!it || it.at[0] !== 'st') return null
    const def = G.defs[it.at[1]]
    return def ? V.itemPos({ ...def, slotsN: G.s?.stations[def.id]?.slots?.length }, it, SHOP) : null
  }

  function sampleAt(t) {
    const S = G.snaps
    if (!S.length) return null
    if (t <= S[0].at) return { a: S[0].s, b: S[0].s, k: 0 }
    for (let i = S.length - 1; i > 0; i--) {
      if (t >= S[i - 1].at) {
        if (t >= S[i].at) return { a: S[i].s, b: S[i].s, k: 0 }
        return { a: S[i - 1].s, b: S[i].s, k: (t - S[i - 1].at) / (S[i].at - S[i - 1].at) }
      }
    }
    return { a: S[S.length - 1].s, b: S[S.length - 1].s, k: 0 }
  }
  const lerp = (a, b, k) => a + (b - a) * k
  const lerpAng = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * k }

  // ---- 毎フレーム
  function frame() {
    if (!G) return
    G.raf = requestAnimationFrame(frame)
    const now = performance.now()
    const dt = Math.min(0.05, (now - G.lastT) / 1000)
    G.lastT = now
    const s = G.s
    if (!s || !G.me) { renderer.render(G.scene, G.camera); return }
    const me = G.me

    // 視点と移動
    if (!G.menu) {
      const [lx, ly] = input.takeLook()
      me.yaw -= lx; me.pitch = Math.max(-1.35, Math.min(1.2, me.pitch - ly))
      const mv = input.move()
      const sp = (mv.run ? SIM.run : SIM.walk) * G.speedMul
      const fx = Math.sin(me.yaw), fz = Math.cos(me.yaw), rx = -Math.cos(me.yaw), rz = Math.sin(me.yaw)
      let nx = me.x + (fx * mv.y + rx * mv.x) * sp * dt, nz = me.z + (fz * mv.y + rz * mv.x) * sp * dt
      // 仲間とぶつかる（重ならない）
      for (const p of Object.values(s.players)) {
        if (p.id === G.you || p.away) continue
        const d = Math.hypot(nx - p.x, nz - p.z)
        if (d < 0.62 && d > 1e-4) { nx = p.x + (nx - p.x) / d * 0.62; nz = p.z + (nz - p.z) / d * 0.62 }
      }
      ;[nx, nz] = collide(nx, nz, G.obs, G.area)
      const moved = Math.hypot(nx - me.x, nz - me.z)
      me.x = nx; me.z = nz
      G.stepAcc += moved
      if (G.stepAcc > (mv.run ? 0.9 : 0.75)) { G.stepAcc = 0; sfx.step() }
      G.bob = (G.bob || 0) + moved * 9
    }
    G.camera.position.set(me.x, 1.6 + Math.sin(G.bob || 0) * 0.025, me.z)
    G.camera.rotation.set(me.pitch, me.yaw + Math.PI, 0)
    G.poseAcc += dt
    if (G.poseAcc >= 1 / POSE_HZ) { G.poseAcc = 0; G.send({ t: 'pose', p: { x: Math.round(me.x * 100) / 100, z: Math.round(me.z * 100) / 100, yaw: Math.round(me.yaw * 1000) / 1000, pitch: Math.round(me.pitch * 1000) / 1000 } }) }

    const smp = sampleAt(now / 1000 - INTERP)
    drawStaff(smp, dt)
    drawCustomers(smp, dt)
    drawItems(s)
    drawStations(s, dt)
    pickTarget(s)
    G.hudAcc += dt
    if (G.hudAcc > 0.1) { G.hudAcc = 0; drawHud(s) }
    renderer.render(G.scene, G.camera)
  }

  function drawStaff(smp, dt) {
    const seen = new Set()
    for (const [id, pb] of Object.entries(smp.b.players)) {
      if (id === G.you || pb.away) continue
      seen.add(id)
      const pa = smp.a.players[id] || pb
      let o = G.staff.get(id)
      if (!o) {
        const mesh = personMesh({ look: id.length, color: pb.color, staff: true })
        const tag = textPlane(pb.name, { w: 0.9, h: 0.22, bg: 'rgba(20,20,20,.7)', fg: '#fff' })
        tag.position.y = 2.15; mesh.add(tag)
        G.scene.add(mesh)
        o = { mesh, tag, phase: 0, px: pb.x, pz: pb.z }
        G.staff.set(id, o)
      }
      const x = lerp(pa.x, pb.x, smp.k), z = lerp(pa.z, pb.z, smp.k)
      o.mesh.position.set(x, 0, z)
      o.mesh.rotation.y = lerpAng(pa.yaw, pb.yaw, smp.k)
      o.tag.quaternion.copy(G.camera.quaternion).premultiply(o.mesh.quaternion.clone().invert())
      walkAnim(o, x, z, dt, !!pb.hold)
    }
    for (const [id, o] of G.staff) if (!seen.has(id)) { G.scene.remove(o.mesh); G.staff.delete(id) }
  }

  function walkAnim(o, x, z, dt, holding) {
    const v = Math.hypot(x - o.px, z - o.pz) / Math.max(dt, 1e-3)
    o.px = x; o.pz = z
    o.phase += Math.min(v, 5) * dt * 3.2
    const sw = v > 0.2 ? Math.sin(o.phase) * 0.5 : 0
    const { legs, arms } = o.mesh.userData
    legs.children[0].rotation.x = sw; legs.children[1].rotation.x = -sw
    if (holding) { arms[0].rotation.x = -1.2; arms[1].rotation.x = -1.2 }
    else { arms[0].rotation.x = -sw * 0.8; arms[1].rotation.x = sw * 0.8 }
  }

  function drawCustomers(smp, dt) {
    const seen = new Set()
    const byIdA = new Map(smp.a.customers.map(c => [c.id, c]))
    for (const cb of smp.b.customers) {
      seen.add(cb.id)
      const ca = byIdA.get(cb.id) || cb
      let o = G.custs.get(cb.id)
      if (!o) {
        const mesh = personMesh({ look: cb.look })
        mesh.traverse(m => { if (m.isMesh) m.userData.target = { k: 'cu', id: cb.id } })
        const bub = makeBubble(); bub.sprite.position.y = 2.08; bub.sprite.scale.set(0.66, 0.41, 1); mesh.add(bub.sprite)
        const say = makeBubble(); say.sprite.position.y = 2.42; say.sprite.scale.set(0.62, 0.39, 1); mesh.add(say.sprite)
        mesh.position.set(cb.x, 0, cb.z)
        G.scene.add(mesh)
        o = { mesh, bub, say, phase: 0, px: cb.x, pz: cb.z }
        G.custs.set(cb.id, o)
      }
      const x = lerp(ca.x, cb.x, smp.k), z = lerp(ca.z, cb.z, smp.k)
      const sit = cb.st === 'eat' && cb.arrived
      o.mesh.position.set(x, sit ? -0.32 : 0, z)
      o.mesh.rotation.y = lerpAng(ca.yaw, cb.yaw, smp.k)
      walkAnim(o, x, z, dt, false)
      setMood(o.mesh, cb.mood)
      drawOrderBubble(o.bub, cb)
      drawSay(o.say, cb.say)
      o.cust = cb
    }
    for (const [id, o] of G.custs) if (!seen.has(id)) { G.scene.remove(o.mesh); G.custs.delete(id) }
  }

  function drawOrderBubble(b, c) {
    const show = (c.st === 'order' && c.arrived) || c.st === 'pay' || c.st === 'queue'
    b.sprite.visible = show
    if (!show) return
    const f = Math.min(1, c.wait / c.patience)
    const key = c.st + c.order.map(l => V.lineTags(l).join() + (l.done ? 1 : 0)).join() + Math.round(f * 24) + c.mood
    if (b.key === key) return
    b.key = key
    const g = b.canvas.getContext('2d'), W = 320, H = 200
    g.clearRect(0, 0, W, H)
    g.fillStyle = c.mood === 'angry' ? '#ffdede' : '#fffaf0'
    g.strokeStyle = c.mood === 'angry' ? '#d13b3b' : '#3b2f25'; g.lineWidth = 6
    g.beginPath(); g.roundRect(6, 6, W - 12, H - 44, 26); g.fill(); g.stroke()
    g.beginPath(); g.moveTo(W / 2 - 18, H - 40); g.lineTo(W / 2, H - 14); g.lineTo(W / 2 + 18, H - 40); g.closePath(); g.fill(); g.stroke()
    if (c.st === 'pay') {
      V.PAY_ICON(g, W / 2 - 60, 70, 70)
      g.fillStyle = '#3b2f25'; g.font = '800 34px "Hiragino Sans",system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle'
      g.fillText('会計', W / 2 - 10, 72)
    } else if (c.st === 'queue') {
      g.fillStyle = '#3b2f25'; g.font = '800 34px "Hiragino Sans",system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'
      g.fillText('順番待ち', W / 2, 70)
    } else {
      // 丼の絵と、指定（硬め・濃いめ・トッピングなど）。普通の1杯なら「ラーメン」
      const l = c.order[0], tags = V.lineTags(l)
      V.drawBowlIcon(g, tags.length ? 62 : W / 2 - 50, 66, 84, l)
      g.fillStyle = '#3b2f25'; g.textBaseline = 'middle'
      if (!tags.length) { g.font = '800 36px "Hiragino Sans",system-ui'; g.textAlign = 'left'; g.fillText('ラーメン', W / 2 - 4, 68) }
      else {
        const fs = tags.length > 3 ? 21 : 26
        g.font = `800 ${fs}px "Hiragino Sans",system-ui`; g.textAlign = 'left'
        tags.forEach((t, i) => {
          const y = 40 + i * (fs + 6) - (tags.length > 3 ? 6 : 0)
          g.fillStyle = t.startsWith('+') ? '#b5401f' : '#2c5a8a'; g.fillText(t, 112, y)
        })
      }
      if (l.done) { g.strokeStyle = '#2f9e44'; g.lineWidth = 10; g.beginPath(); g.moveTo(40, 66); g.lineTo(60, 86); g.lineTo(96, 40); g.stroke() }
    }
    // 待ち時間（残りが減ると色が変わる）
    if (c.st !== 'pay') {
      g.fillStyle = '#d8cfc0'; g.fillRect(30, 128, W - 60, 14)
      g.fillStyle = f < 0.45 ? '#3fae5a' : f < 0.7 ? '#e8b730' : '#e0482f'
      g.fillRect(30, 128, (W - 60) * (1 - f), 14)
    }
    b.tex.needsUpdate = true
  }
  function drawSay(b, text) {
    b.sprite.visible = !!text
    if (!text || b.key === text) return
    b.key = text
    const g = b.canvas.getContext('2d')
    g.clearRect(0, 0, 320, 200)
    g.fillStyle = 'rgba(30,24,18,.86)'; g.beginPath(); g.roundRect(10, 40, 300, 110, 30); g.fill()
    g.fillStyle = '#fff'; g.font = '800 46px "Hiragino Sans",system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(text, 160, 97)
    b.tex.needsUpdate = true
  }

  function drawItems(s) {
    const seen = new Set()
    for (const it of Object.values(s.items)) {
      seen.add(it.id)
      const fam = it.type === 'dirty' ? 'bowl' : it.type
      let o = G.items.get(it.id)
      if (!o || o.fam !== fam) {
        if (o) o.mesh.parent?.remove(o.mesh)
        const mesh = V.itemMesh(it.type)
        mesh.traverse(m => { if (m.isMesh) m.userData.target = { k: 'it', id: it.id } })
        o = { mesh, fam }
        G.items.set(it.id, o)
      }
      V.paintItem(o.mesh, it)
      if (it.at[0] === 'pl') {
        if (it.at[1] === G.you) {
          if (o.mesh.parent !== G.hand) { G.hand.add(o.mesh); o.mesh.position.set(0, 0, 0); o.mesh.rotation.set(0.25, -0.4, 0) }
        } else {
          const so = G.staff.get(it.at[1])
          if (so) { if (o.mesh.parent !== so.mesh) { so.mesh.add(o.mesh); o.mesh.position.set(0, 1.0, 0.42); o.mesh.rotation.set(0, 0, 0) } }
          else o.mesh.parent?.remove(o.mesh)
        }
      } else {
        const p = itemWorld(it)
        if (o.mesh.parent !== G.scene) { G.scene.add(o.mesh); o.mesh.rotation.set(0, 0, 0) }
        if (p) o.mesh.position.set(p.x, p.y, p.z)
      }
    }
    for (const [id, o] of G.items) if (!seen.has(id)) { o.mesh.parent?.remove(o.mesh); G.items.delete(id) }
  }

  function drawStations(s, dt) {
    for (const [id, g] of Object.entries(G.shop.stations)) { const st = s.stations[id]; if (st) V.updateStation(g, st, s, dt, G.camera) }
    // 食べている客の前の丼
    const eating = new Set(s.customers.filter(c => c.st === 'eat').map(c => SHOP.layout.spots.findIndex(([x]) => Math.abs(x - c.x) < 0.05)))
    G.eatBowls.forEach((b, i) => (b.visible = eating.has(i)))
  }

  // 照準の先（真ん中の光線が当たった物。当たらなければ近い向きの物）
  const ray = new THREE.Raycaster(); ray.far = 3.6
  const fwd = new THREE.Vector3()
  function pickTarget(s) {
    const cam = G.camera
    ray.setFromCamera({ x: 0, y: 0 }, cam)
    const objs = []
    for (const g of Object.values(G.shop.stations)) objs.push(g)
    for (const o of G.items.values()) if (o.mesh.parent === G.scene) objs.push(o.mesh)
    for (const o of G.custs.values()) objs.push(o.mesh)
    let best = null
    for (const h of ray.intersectObjects(objs, true)) {
      const t = h.object.userData.target
      if (!t) continue
      if (h.object.parent === G.hand) continue
      const a = actionFor(s, SHOP, G.you, t)
      if (a) { best = { t, a, obj: findRoot(h.object, t) }; break }
      if (!best) best = { t, a: null, obj: findRoot(h.object, t) }
      break
    }
    if (!best || !best.a) {
      // 向きのずれが小さい物を選ぶ（指での操作で狙いやすく）
      cam.getWorldDirection(fwd)
      const maxA = (quality.touch ? 24 : 15) * Math.PI / 180
      let bs = 1e9, alt = null
      const tryT = (t, obj, x, y, z) => {
        tmpV.set(x - cam.position.x, y - cam.position.y, z - cam.position.z)
        const d = tmpV.length(); if (d > 3.4) return
        const ang = tmpV.normalize().angleTo(fwd); if (ang > maxA) return
        const a = actionFor(s, SHOP, G.you, t); if (!a) return
        const sc = ang + d * 0.03 + (a.none ? 0.2 : 0)
        if (sc < bs) { bs = sc; alt = { t, a, obj } }
      }
      for (const [id, g] of Object.entries(G.shop.stations)) { const st = G.defs[id]; tryT({ k: 'st', id }, g, st.x, stationSize(st, SHOP)[2] * 0.8, st.z) }
      for (const [id, o] of G.items) if (o.mesh.parent === G.scene) tryT({ k: 'it', id }, o.mesh, o.mesh.position.x, o.mesh.position.y + 0.1, o.mesh.position.z)
      for (const [id, o] of G.custs) tryT({ k: 'cu', id }, o.mesh, o.mesh.position.x, 1.3, o.mesh.position.z)
      if (alt) best = alt
    }
    G.target = best && best.a ? best.t : null
    G.action = best && best.a ? best.a : null
    if (G.target) {
      const bb = new THREE.Box3().setFromObject(best.obj, true)
      // 頭の上の札は枠に入れない
      if (G.target.k === 'cu') bb.max.y = Math.min(bb.max.y, 1.9)
      if (G.target.k === 'st') bb.max.y = Math.min(bb.max.y, stationSize(G.defs[G.target.id], SHOP)[2] + 0.05)
      bb.getCenter(G.hl.position); bb.getSize(G.hl.scale); G.hl.scale.addScalar(0.06)
      G.hl.visible = true
      G.hl.material.color.set(G.action.none ? 0x9aa0a6 : 0xffd23f)
    } else G.hl.visible = false
  }
  function findRoot(obj, t) {
    if (t.k === 'st') return G.shop.stations[t.id]
    if (t.k === 'it') return G.items.get(t.id)?.mesh || obj
    if (t.k === 'cu') return G.custs.get(t.id)?.mesh || obj
    return obj
  }

  // ---- 画面の文字
  function drawHud(s) {
    const ph = PHASES[s.phase]
    const left = Math.max(0, s.duration - s.t)
    $('#hPhase').textContent = ph.name
    $('#hTime').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`
    $('#hProg').style.width = `${Math.min(100, (s.t / s.duration) * 100)}%`
    $('#hMoney').textContent = `¥${(s.stats.sales - s.stats.cost).toLocaleString()}`
    bgm(true, s.phase / (PHASES.length - 1))
    // 注文票（厨房から見た並び＝右から左が x の小さい順）
    const os = s.customers.filter(c => c.st === 'order' && c.arrived).sort((a, b) => b.x - a.x)
    const key = os.map(c => c.id + c.mood + Math.round(c.wait / c.patience * 20)).join('|')
    if (key !== G.orderKey) {
      G.orderKey = key
      $('#orders').replaceChildren(...os.map(c => {
        const d = document.createElement('div')
        d.className = 'ticket ' + c.mood
        const icons = document.createElement('div'); icons.className = 'ticket-icons'
        for (const l of c.order) {
          const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64
          V.drawBowlIcon(cv.getContext('2d'), 32, 30, 56, l)
          const w = document.createElement('span'); w.className = 'ti'; w.append(cv); icons.append(w)
          const tags = V.lineTags(l)
          if (tags.length) { const tg = document.createElement('span'); tg.className = 'tags'; for (const t of tags) { const e = document.createElement('b'); e.textContent = t; if (t.startsWith('+')) e.className = 'add'; tg.append(e) } icons.append(tg) }
        }
        const bar = document.createElement('i'); bar.style.width = `${Math.max(0, 100 - c.wait / c.patience * 100)}%`
        const barW = document.createElement('div'); barW.className = 'ticket-bar'; barW.append(bar)
        d.append(icons, barW)
        return d
      }))
    }
    const payN = s.customers.filter(c => c.st === 'pay').length
    const qN = s.customers.filter(c => c.st === 'queue').length
    $('#hPay').hidden = !payN; $('#hPay').textContent = `会計待ち ${payN}`
    $('#hQueue').hidden = !qN; $('#hQueue').textContent = `並び ${qN}`

    // 照準の先でできること
    const pr = $('#prompt')
    if (G.action) {
      pr.hidden = false
      pr.dataset.none = G.action.none ? '1' : '0'
      pr.innerHTML = (G.action.none ? ICONS.info : ICONS[KIND_ICON[G.action.kind]] || ICONS.take) + `<span></span>` + (quality.touch || G.action.none ? '' : '<kbd>E</kbd>')
      pr.querySelector('span').textContent = G.action.label
    } else pr.hidden = true
    $('#useBtn').dataset.on = G.action && !G.action.none ? '1' : '0'
    // 持っている物
    const p = s.players[G.you]
    const it = p?.hold && s.items[p.hold]
    const hb = $('#held')
    if (it) {
      hb.hidden = false
      const t = V.heldLabel(it)
      hb.textContent = t
    } else hb.hidden = true
    // 案内（はじめの営業だけ）
    const h = G.hints ? V.hint(s, p, it) : null
    $('#hint').hidden = !h
    if (h) $('#hint').textContent = h.text
    let tgt = h && h.at
    // 近くまで来たら矢印は消す（照準の枠で足りる）
    if (tgt) {
      const st = tgt.k === 'st' ? G.defs[tgt.id] : tgt.k === 'it' ? (() => { const p = itemWorld(s.items[tgt.id]); return p && { x: p.x, z: p.z } })() : s.customers.find(c => c.id === tgt.id)
      if (!st || Math.hypot(st.x - G.me.x, st.z - G.me.z) < 2.4) tgt = null
    }
    G.arrow.visible = !!tgt
    if (tgt) {
      const bob = Math.sin(performance.now() / 180) * 0.06
      if (tgt.k === 'st') { const st = G.defs[tgt.id]; G.arrow.position.set(st.x, stationSize(st, SHOP)[2] + 0.35 + bob, st.z) }
      else if (tgt.k === 'it') { const p = itemWorld(s.items[tgt.id]); if (p) G.arrow.position.set(p.x, p.y + 0.45 + bob, p.z) }
      else { const c = s.customers.find(c => c.id === tgt.id); if (c) G.arrow.position.set(c.x, 2.0, c.z) }
    }
  }

  return { start, stop, onSnap, onActr, get running() { return !!G } }
}
