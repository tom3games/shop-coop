// ラーメン屋の見た目と案内。設備の形・店内の飾り（のれん・提灯・短冊・丸椅子）・品物の形・湯気・
// 注文の絵・持っている物の呼び名・次にやることの案内・出来事の音と文。共通の画面（game.js / world.js）から呼ばれる。
import * as THREE from '../../vendor/three.module.js'
import { box, cyl, std, tex, textPlane, makeGauge } from '../world.js'
import { stationSize } from '../../shared/sim.js'
import { SHOP, BOIL, TOPPINGS, HARD, boilLabel, lineTags } from '../../shared/shops/ramen.js'

const steel = std(0xb7bec4, { metalness: 0.7, roughness: 0.32 })
const steelDark = std(0x6d757c, { metalness: 0.6, roughness: 0.4 })
const woodM = std(0x8a5a33)
const FONT = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif'

// 縦書きの札（短冊・のれん用）
function vertical(text, { w = 0.3, h = 0.8, bg = '#f4ead2', fg = '#2b1a10', border = '#8a5a33' } = {}) {
  const cw = 128, ch = Math.round(128 * h / w)
  const t = tex(cw, ch, g => {
    g.fillStyle = bg; g.fillRect(0, 0, cw, ch)
    if (border) { g.strokeStyle = border; g.lineWidth = 6; g.strokeRect(3, 3, cw - 6, ch - 6) }
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'
    const chars = [...text], fs = Math.min(cw * 0.7, (ch - 20) / chars.length * 0.92)
    g.font = `800 ${fs}px ${FONT}`
    chars.forEach((c, i) => g.fillText(c, cw / 2, 14 + fs * 0.55 + i * ((ch - 28) / chars.length)))
  })
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }))
}

// ---- 湯気（その場で作る白い粒。強さで量が変わる）
const steamTex = (() => {
  let t = null
  return () => t || (t = tex(64, 64, g => { const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64) }))
})()
function makeSteam(parent, y, spread = 0.4, n = 14) {
  const ps = []
  for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex(), transparent: true, depthWrite: false, opacity: 0 }))
    s.userData = { life: 0, max: 1 }
    parent.add(s); ps.push(s)
  }
  let acc = 0
  return {
    update(dt, power) {
      acc += dt * (1 + power * 9)
      for (const s of ps) {
        const u = s.userData
        if (u.life <= 0 && acc > 0.35) {
          acc -= 0.35
          u.life = u.max = 1.4 + Math.random() * 0.8
          s.position.set((Math.random() - 0.5) * spread, y, (Math.random() - 0.5) * spread * 0.6)
          u.vx = (Math.random() - 0.5) * 0.08
        }
        if (u.life > 0) {
          u.life -= dt
          s.position.y += dt * (0.35 + power * 0.3); s.position.x += u.vx * dt
          const k = 1 - u.life / u.max
          s.scale.setScalar(0.18 + k * (0.5 + power * 0.4))
          s.material.opacity = Math.sin(Math.PI * k) * (0.18 + power * 0.42)
        } else s.material.opacity = 0
      }
      if (acc > 1) acc = 1
    }
  }
}

// ---- 店内の飾り
export function decorate(root, shop, { H, counterM }) {
  const L = shop.layout
  const [fx0, fz0, fx1, fz1] = L.floor
  // 厨房の奥の壁は白いタイル
  const tile = tex(256, 256, (g, w) => {
    g.fillStyle = '#f4f2ec'; g.fillRect(0, 0, w, w)
    g.strokeStyle = '#cfcac0'; g.lineWidth = 4
    for (let y = 0; y <= 8; y++) { g.beginPath(); g.moveTo(0, y * 32); g.lineTo(w, y * 32); g.stroke(); for (let x = 0; x <= 4; x++) { const ox = (y % 2) * 32; g.beginPath(); g.moveTo(x * 64 + ox, y * 32); g.lineTo(x * 64 + ox, y * 32 + 32); g.stroke() } }
  })
  tile.wrapS = tile.wrapT = THREE.RepeatWrapping; tile.repeat.set((fx1 - fx0) / 1.2, 1.4)
  const back = new THREE.Mesh(new THREE.PlaneGeometry(fx1 - fx0, 1.7), std(0xffffff, { map: tile, roughness: 0.3 }))
  back.position.set((fx0 + fx1) / 2, 1.0 + 0.85, fz0 + 0.005); root.add(back)
  // 客席側の腰板（濃い木）
  for (const x of [fx0 + 0.005, fx1 - 0.005]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(fz1 - 1.4, 1.1), woodM)
    p.position.set(x, 0.55, (1.4 + fz1) / 2); p.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2; root.add(p)
  }
  // 店名の大看板（厨房の奥）と、短冊のお品書き
  const sign = textPlane(shop.name, { w: 3.2, h: 0.62, bg: '#9e1b1b', fg: '#fff3dc' })
  sign.position.set(0, 2.85, fz0 + 0.02); root.add(sign)
  const menu = ['ラーメン 八五〇', '味玉 百', 'チャーシュー 二〇〇', '硬め 柔らかめ', '味濃いめ', '油多め', '大盛り 無料']
  menu.forEach((m, i) => {
    const s = vertical(m, { w: 0.26, h: 0.9 })
    s.position.set(fx0 + 0.02, 2.35, -3.4 + i * 0.34); s.rotation.y = Math.PI / 2; root.add(s)
  })
  // 客席側の壁にもお品書き（厨房から見える）
  menu.slice(0, 5).forEach((m, i) => {
    const s = vertical(m, { w: 0.3, h: 1.0 })
    s.position.set(fx1 - 0.02, 2.2, 3.0 + i * 0.4); s.rotation.y = -Math.PI / 2; root.add(s)
  })
  // のれん（入口の内側から見える向き）
  const [dx] = L.door
  const nt = tex(512, 256, g => {
    g.clearRect(0, 0, 512, 256)
    for (let i = 0; i < 4; i++) { g.fillStyle = '#1c2a4a'; g.fillRect(i * 128 + 3, 0, 122, 256) }
    g.fillStyle = '#fff'; g.font = `800 120px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'
    ;['ら', 'ぁ', 'め', 'ん'].forEach((c, i) => g.fillText(c, i * 128 + 64, 140))
  })
  const noren = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.9), new THREE.MeshStandardMaterial({ map: nt, transparent: true, side: THREE.DoubleSide, roughness: 1 }))
  noren.position.set(dx, H - 0.7 - 0.45 + 0.05, fz1 - 0.08); noren.rotation.y = Math.PI; root.add(noren)
  // 提灯（入口の両わきとカウンターの上）
  const lanternTex = tex(128, 128, g => { g.fillStyle = '#d42a1e'; g.fillRect(0, 0, 128, 128); g.strokeStyle = 'rgba(80,0,0,.45)'; g.lineWidth = 3; for (let y = 8; y < 128; y += 12) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke() } g.fillStyle = '#fff3d6'; g.font = `800 64px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('麺', 64, 66) })
  const lanternM = new THREE.MeshStandardMaterial({ map: lanternTex, emissive: 0xff5a2a, emissiveIntensity: 0.55, roughness: 0.8 })
  for (const [x, y, z] of [[dx - 1.5, 2.2, fz1 - 0.4], [dx + 1.5, 2.2, fz1 - 0.4], [-4.8, 2.85, 3.8], [-1.6, 2.85, 3.8], [1.6, 2.85, 3.8]]) {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 14), lanternM); body.scale.y = 1.35; g.add(body)
    for (const yy of [-0.33, 0.33]) { const c = cyl(0.12, 0.12, 0.06, std(0x1a1a1a)); c.position.y = yy; g.add(c) }
    const cord = cyl(0.01, 0.01, H - y - 0.36, std(0x1a1a1a)); cord.position.y = 0.36 + (H - y - 0.36) / 2; g.add(cord)
    g.position.set(x, y, z); root.add(g)
  }
  // 丸椅子（カウンター席）と卓上の調味料
  const seatM = std(0xb3241b, { roughness: 0.5 })
  for (const [x, z] of L.spots) {
    const s = cyl(0.2, 0.2, 0.08, seatM); s.position.set(x, 0.66, z + 0.3); root.add(s)
    const leg = cyl(0.04, 0.05, 0.62, steel); leg.position.set(x, 0.31, z + 0.3); root.add(leg)
    const base = cyl(0.18, 0.2, 0.03, steel); base.position.set(x, 0.015, z + 0.3); root.add(base)
    const jar = cyl(0.04, 0.04, 0.12, std(0x7a1a10)); jar.position.set(x + 0.5, 1.07, 1.3); root.add(jar)
    const jar2 = cyl(0.035, 0.035, 0.1, std(0xe8e0c8)); jar2.position.set(x + 0.6, 1.06, 1.3); root.add(jar2)
  }
  // カウンターの客側の赤い帯
  const c = L.counter
  root.add(box(c.x1 - c.x0, 0.1, 0.02, std(0x9e1b1b), (c.x0 + c.x1) / 2, 0.85, c.z1 + 0.01))
  // 待ち椅子（長椅子）
  const qx = L.queue.map(q => q[0])
  const bench = box(Math.max(...qx) - Math.min(...qx) + 0.8, 0.08, 0.45, woodM, (Math.max(...qx) + Math.min(...qx)) / 2, 0.45, L.queue[0][1] + 0.35)
  root.add(bench)
  void counterM
}

// ---- 設備の形
export function buildStation(def) {
  const g = new THREE.Group()
  const [w, d, h] = stationSize(def, SHOP)
  switch (def.type) {
    case 'boiler': {
      g.add(box(w, h - 0.05, d, steel, 0, (h - 0.05) / 2, 0))
      g.add(box(w - 0.1, 0.02, d - 0.1, std(0x2c3a42, { roughness: 0.15, metalness: 0.2 }), 0, h - 0.04, 0))
      const water = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.12, d - 0.12), new THREE.MeshStandardMaterial({ color: 0x9cc4d6, roughness: 0.05, transparent: true, opacity: 0.75, emissive: 0x335566, emissiveIntensity: 0.3 }))
      water.rotation.x = -Math.PI / 2; water.position.y = h - 0.02; g.add(water)
      g.add(box(w, 0.05, 0.06, steelDark, 0, h * 0.55, d / 2 + 0.02))
      for (const x of [-0.5, 0.5]) { const k = cyl(0.05, 0.05, 0.05, std(0x1a1a1a)); k.rotation.x = Math.PI / 2; k.position.set(x, h * 0.3, d / 2 + 0.02); g.add(k) }
      g.userData.steam = makeSteam(g, h, w * 0.6, 18)
      g.userData.gauges = []
      g.userData.water = water
      break
    }
    case 'soup': {
      g.add(box(w * 0.9, 0.45, d * 0.9, std(0x2c2f33), 0, 0.225, 0))
      const pot = cyl(0.42, 0.4, 0.56, steel, 28); pot.position.y = 0.73; g.add(pot)
      const surf = cyl(0.39, 0.39, 0.01, std(0xb8783a, { roughness: 0.2 }), 28); surf.position.y = 0.995; g.add(surf)
      const ladle = cyl(0.015, 0.015, 0.6, steel); ladle.position.set(0.2, 1.1, 0); ladle.rotation.z = 0.5; g.add(ladle)
      g.userData.steam = makeSteam(g, 1.02, 0.5, 12)
      break
    }
    case 'flavor': {
      g.add(box(w, 0.85, d, steelDark, 0, 0.425, 0))
      if (def.flag === 'koi') { const b = cyl(0.08, 0.1, 0.32, std(0x3a1d0c, { roughness: 0.2 })); b.position.y = 1.01; g.add(b); const cap = cyl(0.04, 0.04, 0.06, std(0xc0392b)); cap.position.y = 1.2; g.add(cap) }
      else { const j = cyl(0.16, 0.14, 0.2, std(0xf2ead2, { roughness: 0.4 })); j.position.y = 0.95; g.add(j); const s = cyl(0.14, 0.14, 0.01, std(0xfff8e6)); s.position.y = 1.055; g.add(s) }
      break
    }
    case 'topping': {
      g.add(box(w, 0.85, d, steelDark, 0, 0.425, 0))
      g.add(box(w * 0.85, 0.06, d * 0.8, steel, 0, 0.88, 0))
      const tray = new THREE.Group(); tray.position.y = 0.92; g.add(tray)
      if (def.top === 'negi') for (let i = 0; i < 18; i++) { const n = cyl(0.02, 0.02, 0.012, std(0x4caf50), 8); n.position.set((Math.random() - 0.5) * 0.45, 0, (Math.random() - 0.5) * 0.35); tray.add(n) }
      if (def.top === 'chashu') for (let i = 0; i < 5; i++) { const n = cyl(0.08, 0.08, 0.02, std(0xc58b6a), 16); n.position.set(-0.2 + i * 0.1, 0.01 + i * 0.004, 0); n.rotation.z = 0.3; tray.add(n) }
      if (def.top === 'ajitama') for (let i = 0; i < 4; i++) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(0xd99a3e)); e.position.set(-0.15 + i * 0.1, 0, 0); tray.add(e) }
      break
    }
    case 'bowls': {
      g.add(box(w, 0.8, d, woodM, 0, 0.4, 0))
      const list = []
      for (let i = 0; i < 10; i++) { const b = bowlShape(); b.scale.setScalar(0.85); b.position.set(-0.22 + (i % 2) * 0.44, 0.8 + Math.floor(i / 2) * 0.075, 0); g.add(b); list.push(b) }
      g.userData.bowls = list
      break
    }
    case 'sink': {
      g.add(box(w, h - 0.05, d, steel, 0, (h - 0.05) / 2, 0))
      g.add(box(w - 0.12, 0.02, d - 0.12, std(0x3c464d, { roughness: 0.2 }), 0, h - 0.04, 0))
      const f = cyl(0.025, 0.025, 0.4, steel); f.position.set(0, h + 0.2, -d / 2 + 0.08); g.add(f)
      const sp = cyl(0.02, 0.02, 0.25, steel); sp.rotation.x = Math.PI / 2; sp.position.set(0, h + 0.38, -d / 2 + 0.2); g.add(sp)
      g.userData.steam = makeSteam(g, h, 0.6, 6)
      break
    }
    case 'supply': {
      if (def.item === 'noodle') {
        g.add(box(w, h, d, std(0xb38755), 0, h / 2, 0))
        g.add(box(w * 0.86, 0.02, d * 0.86, std(0x5a3d22), 0, h - 0.01, 0))
        const list = []
        for (let i = 0; i < 8; i++) { const n = noodleShape(); n.position.set(-0.2 + (i % 2) * 0.4, h + 0.03, -0.36 + Math.floor(i / 2) * 0.24); g.add(n); list.push(n) }
        g.userData.stockMeshes = list
      } else {
        const card = std(0xc79a62)
        for (const [x, y, z] of [[-0.3, 0.225, 0.2], [0.32, 0.225, 0.22], [0, 0.675, 0.05], [-0.3, 0.225, -0.3]]) { g.add(box(0.6, 0.45, 0.5, card, x, y, z)) }
        const lb = textPlane('麺', { w: 0.3, h: 0.3, bg: '#f4ead2', fg: '#9e1b1b' }); lb.position.set(0, 0.68, 0.31); g.add(lb)
      }
      break
    }
    case 'table': {
      g.add(box(w, 0.06, d, steel, 0, 0.87, 0))
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(box(0.06, 0.84, 0.06, steel, x * (w / 2 - 0.08), 0.42, z * (d / 2 - 0.08)))
      g.add(box(w - 0.1, 0.03, d - 0.1, steel, 0, 0.25, 0))
      for (const [sx, sz] of def.slots) { const r = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.19, 24), new THREE.MeshBasicMaterial({ color: 0x5c6670 })); r.rotation.x = -Math.PI / 2; r.position.set(sx, 0.905, sz); g.add(r) }
      break
    }
    case 'trash': {
      const b = cyl(0.28, 0.24, 0.8, std(0x4c6a4f)); b.position.y = 0.4; g.add(b)
      const lid = cyl(0.3, 0.3, 0.04, std(0x2f4532)); lid.position.y = 0.8; g.add(lid)
      break
    }
    case 'register': {
      g.add(box(w, 0.95, d, std(0x6b3f22), 0, 0.475, 0))
      g.add(box(0.5, 0.18, 0.4, std(0x30343a), 0, 1.05, 0))
      const scr = box(0.4, 0.25, 0.04, std(0x111111, { emissive: 0x2a8a4a, emissiveIntensity: 0.9 }), 0, 1.3, 0.12)
      scr.rotation.x = -0.4; scr.rotation.y = Math.PI; g.add(scr)
      break
    }
  }
  return g
}

// 設備の様子を状態に合わせる（湯気・ゲージ・残りの数）
export function updateStation(g, st, S, dt, cam) {
  const u = g.userData
  if (st.type === 'boiler') {
    const items = st.slots.map(id => id && S.items[id])
    // ゲージ（てぼごと）
    while (u.gauges.length < st.slots.length) {
      const gg = makeGauge(0.62); gg.mesh.visible = false; g.add(gg.mesh); u.gauges.push(gg)
      // てぼ（麺を入れるかご）と取っ手
      const x = slotX(st.slots.length, u.gauges.length - 1)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.012, 6, 24), steel); ring.rotation.x = Math.PI / 2; ring.position.set(x, 0.95, 0.05); g.add(ring)
      const handle = cyl(0.012, 0.012, 0.38, steelDark); handle.rotation.x = Math.PI / 2 - 0.35; handle.position.set(x, 1.0, 0.33); g.add(handle)
    }
    let power = 0.15
    items.forEach((it, i) => {
      const gg = u.gauges[i]
      gg.mesh.visible = !!it
      if (!it) return
      const x = slotX(st.slots.length, i)
      gg.mesh.position.set(x, 1.32 + (i % 2) * 0.16, 0.25)
      gg.mesh.quaternion.copy(cam.quaternion)
      const key = Math.round(it.cook * 8)
      if (gg.key !== key) { gg.key = key; gg.draw([[...BOIL.windows.kata, '#4fa3e0'], [...BOIL.windows.normal, '#3fae5a'], [...BOIL.windows.yawa, '#e08a2e'], [BOIL.nobi, BOIL.maxShow, '#c9302c']], it.cook, BOIL.maxShow) }
      // 茹で上がりが近いほど湯気が立つ。のびると泡立つ
      power = Math.max(power, Math.min(1, Math.max(0, (it.cook - 3.5) / 3.5)))
    })
    u.steam.update(dt, power)
    u.water.material.emissiveIntensity = 0.3 + power * 0.25
  } else if (st.type === 'soup') u.steam.update(dt, 0.35)
  else if (st.type === 'sink') u.steam.update(dt, st.slots.some(Boolean) ? 0.5 : 0)
  else if (st.type === 'bowls') u.bowls.forEach((b, i) => (b.visible = i < st.stock))
  else if (st.type === 'supply' && u.stockMeshes) u.stockMeshes.forEach((b, i) => (b.visible = i < st.stock))
}
const slotX = (n, i) => (i - (n - 1) / 2) * (n > 2 ? 0.46 : 0.6)

// ---- 品物
function bowlShape() {
  const g = new THREE.Group()
  const pts = []
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(0.07 + Math.sin(t * Math.PI / 2) * 0.12, t * 0.12)) }
  const outer = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), new THREE.MeshStandardMaterial({ color: 0x9e1b1b, roughness: 0.35, side: THREE.DoubleSide }))
  outer.castShadow = true; g.add(outer)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.008, 6, 28), std(0xf4ead2)); rim.rotation.x = Math.PI / 2; rim.position.y = 0.12; g.add(rim)
  const inner = new THREE.Mesh(new THREE.CircleGeometry(0.18, 24), std(0xf6efe0)); inner.rotation.x = -Math.PI / 2; inner.position.y = 0.04; g.add(inner)
  return g
}
function noodleShape() {
  const g = new THREE.Group()
  const m = std(0xf0d27a, { roughness: 0.8 })
  for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.018, 6, 18), m); t.rotation.x = Math.PI / 2; t.position.set((i - 1) * 0.03, 0.02 + i * 0.012, (i % 2) * 0.02); g.add(t) }
  g.userData.mat = m
  return g
}
const noodleTex = (() => { let t; return () => t || (t = tex(128, 128, g => { g.fillStyle = '#f2d47e'; g.fillRect(0, 0, 128, 128); g.strokeStyle = '#d9b45a'; g.lineWidth = 3; for (let i = 0; i < 18; i++) { g.beginPath(); g.moveTo(0, i * 7 + 3); g.bezierCurveTo(40, i * 7 - 6, 80, i * 7 + 12, 128, i * 7 + 2); g.stroke() } })) })()

export function itemMesh(type) {
  const g = new THREE.Group()
  if (type === 'noodle') { const n = noodleShape(); g.add(n); g.userData.noodle = n }
  else if (type === 'bowl' || type === 'dirty') {
    const b = bowlShape(); g.add(b)
    const soup = new THREE.Mesh(new THREE.CircleGeometry(0.175, 24), new THREE.MeshStandardMaterial({ color: 0xc58a46, roughness: 0.15 }))
    soup.rotation.x = -Math.PI / 2; soup.position.y = 0.1; g.add(soup)
    const oil = new THREE.Mesh(new THREE.CircleGeometry(0.17, 24), new THREE.MeshStandardMaterial({ map: tex(64, 64, gg => { gg.clearRect(0, 0, 64, 64); gg.fillStyle = 'rgba(255,236,170,.8)'; for (let i = 0; i < 26; i++) { gg.beginPath(); gg.arc(Math.random() * 64, Math.random() * 64, 1.5 + Math.random() * 2.5, 0, 7); gg.fill() } }), transparent: true, roughness: 0.05 }))
    oil.rotation.x = -Math.PI / 2; oil.position.y = 0.103; g.add(oil)
    const noodle = new THREE.Mesh(new THREE.CircleGeometry(0.12, 20), new THREE.MeshStandardMaterial({ map: noodleTex(), roughness: 0.7 }))
    noodle.rotation.x = -Math.PI / 2; noodle.position.set(0.02, 0.106, 0); g.add(noodle)
    const negi = new THREE.Group(); negi.position.y = 0.112
    for (let i = 0; i < 9; i++) { const n = cyl(0.016, 0.016, 0.01, std(0x4caf50), 8); n.position.set(-0.04 + (i % 3) * 0.03, 0, -0.08 + Math.floor(i / 3) * 0.03); negi.add(n) }
    g.add(negi)
    const chashu = cyl(0.06, 0.06, 0.015, std(0xc58b6a), 16); chashu.position.set(-0.07, 0.115, 0.05); chashu.rotation.z = 0.2; g.add(chashu)
    const egg = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(0xf2f0e6)); egg.position.set(0.08, 0.108, 0.06); g.add(egg)
    const yolk = cyl(0.025, 0.025, 0.005, std(0xe08a2e), 12); yolk.position.set(0.08, 0.153, 0.06); g.add(yolk)
    const hashi = new THREE.Group()
    for (const z of [-0.012, 0.012]) { const c = cyl(0.005, 0.004, 0.32, std(0xd8b98f)); c.rotation.z = Math.PI / 2 - 0.2; c.position.set(0.05, 0.16, z); hashi.add(c) }
    g.add(hashi)
    g.userData = { soup, oil, noodle, negi, chashu, egg: [egg, yolk], hashi }
  } else if (type === 'crate') {
    g.add(box(0.5, 0.36, 0.4, std(0xc79a62), 0, 0.18, 0))
    const lb = textPlane('麺', { w: 0.2, h: 0.2, bg: '#f4ead2', fg: '#9e1b1b' }); lb.position.set(0, 0.2, 0.205); g.add(lb)
  }
  return g
}
const tmpC = new THREE.Color()
export function paintItem(mesh, it) {
  const u = mesh.userData
  if (it.type === 'noodle' && u.noodle) {
    const k = Math.min(1, (it.cook || 0) / BOIL.nobi)
    u.noodle.userData.mat.color.setRGB(0.94 - k * 0.04, 0.82 + k * 0.08, 0.48 + k * 0.3)
    u.noodle.scale.setScalar(1 + k * 0.35)
  } else if (u.soup) {
    const dirty = it.type === 'dirty'
    u.soup.visible = dirty || !!it.soup
    u.soup.material.color.copy(dirty ? tmpC.setHex(0xa88866) : tmpC.setHex(it.koi ? 0x8a4f22 : 0xc58a46))
    u.soup.position.y = dirty ? 0.05 : 0.1
    u.oil.visible = !dirty && !!it.oil
    u.noodle.visible = !dirty && it.noodle != null
    if (u.noodle.visible) { const nobi = it.noodle >= BOIL.nobi; u.noodle.scale.setScalar(nobi ? 1.35 : 1); u.noodle.material.color.setHex(nobi ? 0xfff0d0 : 0xffffff) }
    const top = it.top || []
    u.negi.visible = !dirty && top.includes('negi')
    u.chashu.visible = !dirty && top.includes('chashu')
    for (const m of u.egg) m.visible = !dirty && top.includes('ajitama')
    u.hashi.visible = dirty
  }
}

// 品物の置き場所（設備の中の位置）
export function itemPos(def, it, shop) {
  if (def.type === 'boiler') { const n = def.slotsN; return { x: def.x + slotX(n, it.at[2]), y: 0.9, z: def.z + 0.05 } }
  if (def.type === 'sink') return { x: def.x + (it.at[2] ? 0.28 : -0.28), y: 0.78, z: def.z + 0.05 }
  if (def.type === 'table') { const [sx, sz] = def.slots[it.at[2]]; return { x: def.x + sx, y: 0.9, z: def.z + sz } }
  if (def.type === 'counter') { const [x] = shop.layout.spots[it.at[2]]; return { x, y: 1.01, z: 1.15 } }
  return null
}

// ---- 注文の絵
export function drawBowlIcon(g, x, y, s, line) {
  g.save(); g.translate(x, y); g.scale(s / 64, s / 64)
  g.fillStyle = '#f3d27a'; g.beginPath(); g.ellipse(0, -2, 24, 8, 0, 0, Math.PI * 2); g.fill()
  g.strokeStyle = '#d9b45a'; g.lineWidth = 2.5
  for (const dx of [-12, -4, 4, 12]) { g.beginPath(); g.moveTo(dx - 6, -6); g.quadraticCurveTo(dx, 2, dx + 6, -5); g.stroke() }
  if (line?.koi) { g.fillStyle = '#5a2d10'; g.beginPath(); g.ellipse(-12, -2, 7, 3, 0, 0, 7); g.fill() }
  g.fillStyle = '#9e1b1b'; g.beginPath(); g.moveTo(-28, -2); g.lineTo(28, -2); g.quadraticCurveTo(24, 22, 0, 24); g.quadraticCurveTo(-24, 22, -28, -2); g.fill()
  g.fillStyle = '#f4ead2'; g.fillRect(-14, 6, 28, 3)
  g.strokeStyle = '#d8b98f'; g.lineWidth = 3; g.beginPath(); g.moveTo(6, -20); g.lineTo(26, -4); g.moveTo(10, -22); g.lineTo(30, -6); g.stroke()
  g.restore()
}
export { lineTags }
export const PAY_ICON = (g, x, y, s) => {
  g.save(); g.translate(x, y); g.scale(s / 64, s / 64)
  g.fillStyle = '#ffd36b'; g.beginPath(); g.arc(0, 0, 22, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#7a5a10'; g.font = '800 26px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('¥', 0, 2)
  g.restore()
}

// 持っている物の呼び名
export function heldLabel(it) {
  if (it.type === 'noodle') return '麺（生）'
  if (it.type === 'crate') return '麺の箱'
  if (it.type === 'dirty') return '食べ終わった丼'
  if (it.type === 'bowl') {
    if (!it.soup) return '空の丼'
    const parts = ['スープ']
    if (it.koi) parts.push('濃いめ')
    if (it.oil) parts.push('油多め')
    if (it.noodle != null) parts.push(`麺（${boilLabel(it.noodle)}）`)
    for (const t of it.top || []) parts.push(TOPPINGS[t])
    return '丼: ' + parts.join('・')
  }
  return it.type
}

// 次にやることの案内（はじめの営業だけ）。at は矢印を出す場所
export function hint(s, p, it) {
  const wants = () => s.customers.filter(c => c.st === 'order' && c.arrived).sort((a, b) => b.wait / b.patience - a.wait / a.patience)
  const boilers = Object.values(s.stations).filter(x => x.type === 'boiler')
  const boiling = boilers.flatMap(b => b.slots.filter(Boolean).map(id => s.items[id]))
  const top = wants()[0]
  const need = top && top.order.find(l => !l.done)
  if (it) {
    if (it.type === 'noodle') { const b = boilers.find(b => b.slots.includes(null)); return { text: '茹で釜（てぼ）に入れよう', at: b && { k: 'st', id: b.id } } }
    if (it.type === 'crate') return { text: '麺の箱に入れて補充しよう', at: { k: 'st', id: 'noodles' } }
    if (it.type === 'dirty') return { text: '洗い場に入れよう', at: { k: 'st', id: 'sink' } }
    if (it.type === 'bowl') {
      if (!it.soup) return { text: '寸胴でスープを入れよう', at: { k: 'st', id: 'soup' } }
      if (need?.koi && !it.koi) return { text: '「味濃いめ」はかえしを足す', at: { k: 'st', id: 'tare' } }
      if (need?.oil && !it.oil) return { text: '「油多め」は背脂を足す', at: { k: 'st', id: 'abura' } }
      if (it.noodle == null) {
        if (!boiling.length) return { text: '麺を茹でよう（丼は作業台に置ける）', at: { k: 'st', id: 'island' } }
        const h = need?.hard || 'normal'
        return { text: `ゲージの${h === 'kata' ? '青（硬め）' : h === 'yawa' ? 'オレンジ（柔らかめ）' : '緑（普通）'}で麺を盛ろう`, at: { k: 'st', id: boilers.find(b => b.slots.some(Boolean))?.id } }
      }
      if (!it.top?.includes('negi')) return { text: 'ネギをのせよう', at: { k: 'st', id: 'negi' } }
      const miss = (need?.top || []).find(t => !it.top.includes(t))
      if (miss) return { text: `${TOPPINGS[miss]}の追加がある`, at: { k: 'st', id: miss } }
      return { text: 'お客さんに出そう（カウンター越し）', at: top && { k: 'cu', id: top.id } }
    }
  }
  if (s.customers.some(c => c.st === 'pay' && c.payIdx === 0 && c.arrived)) return { text: 'レジで会計しよう', at: { k: 'st', id: 'register' } }
  const dirty = s.stations.counter.slots.find(Boolean)
  if (dirty && (s.stations.bowls.stock <= 2 || s.customers.some(c => c.st === 'queue'))) return { text: '食べ終わった丼を下げよう（席が空く）', at: { k: 'it', id: dirty } }
  if (s.stations.noodles.stock === 0) return { text: '麺がない。右奥の在庫を麺の箱へ', at: { k: 'st', id: 'crates' } }
  if (s.stations.bowls.stock === 0) return { text: '丼がない。下げて洗おう', at: dirty ? { k: 'it', id: dirty } : null }
  const ready = boiling.find(n => n.cook >= BOIL.windows.kata[0])
  if (ready) return { text: '麺が茹で上がる。丼にスープを入れて盛ろう', at: { k: 'st', id: 'bowls' } }
  if (top && boiling.length < wants().length && boilers.some(b => b.slots.includes(null))) return { text: '左の麺の箱から麺を取ろう', at: { k: 'st', id: 'noodles' } }
  if (boiling.length) return { text: '茹でている間に丼とスープを用意', at: { k: 'st', id: 'bowls' } }
  if (dirty) return { text: '食べ終わった丼を下げて洗おう', at: { k: 'it', id: dirty } }
  if (!s.customers.length) return { text: 'お客さんを待とう', at: null }
  return null
}

// 出来事の文（流れる知らせ）
export function feedFor(e, who) {
  switch (e.type) {
    case 'nobi': return ['麺がのびてる！', 'bad']
    case 'stockout': return e.st === 'noodles' ? ['麺の箱が空。在庫を運ぼう', 'warn'] : null
    case 'nobowl': return ['丼が切れた。下げて洗おう', 'warn']
    case 'refill': return [`${who(e.by)}が麺を補充`, '']
    case 'ate': return ['食べ終わった。丼を下げよう', '']
  }
  return null
}

export const HARD_LABEL = HARD
