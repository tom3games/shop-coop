// 店の3D。動かない部分（床・壁・カウンター・設備）と、動く物（品物・客・店員）の形を作る。
// 形は全部その場で組み立てる（モデルファイルなし。読み込みが軽い）。
import * as THREE from '../vendor/three.module.js'
import { stationSize } from '../shared/sim.js'

const tex = (w, h, draw) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
  return t
}
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...o })
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true
  return m
}
function cyl(rt, rb, h, mat, seg = 18) { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); m.castShadow = true; return m }

// 文字の板（設備の看板など）
export function textPlane(text, { w = 1, h = 0.26, bg = '#2b2118', fg = '#ffe9c2', size = 64 } = {}) {
  const cw = 512, ch = Math.round(512 * h / w)
  const t = tex(cw, ch, (g) => {
    g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, cw, ch, ch * 0.22); g.fill()
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'
    let fs = Math.min(size * (ch / 128), ch * 0.7)
    g.font = `800 ${fs}px "Hiragino Sans","Noto Sans JP",system-ui,sans-serif`
    while (g.measureText(text).width > cw * 0.9 && fs > 10) { fs -= 2; g.font = `800 ${fs}px "Hiragino Sans","Noto Sans JP",system-ui,sans-serif` }
    g.fillText(text, cw / 2, ch / 2 + fs * 0.04)
  })
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true }))
  return m
}

// ---- 動かない店
export function buildShop(scene, shop, upgrades, quality) {
  const L = shop.layout
  const [fx0, fz0, fx1, fz1] = L.floor
  const root = new THREE.Group()
  scene.add(root)

  // 床: 厨房はタイル、客席は木
  const tile = tex(256, 256, (g, w) => {
    g.fillStyle = '#d9d4c7'; g.fillRect(0, 0, w, w)
    g.strokeStyle = '#b9b2a2'; g.lineWidth = 6
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, w); g.stroke(); g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke() }
  })
  tile.wrapS = tile.wrapT = THREE.RepeatWrapping; tile.repeat.set((fx1 - fx0) / 2, 6.4 / 2)
  const kitchen = new THREE.Mesh(new THREE.PlaneGeometry(fx1 - fx0, 6.4), std(0xffffff, { map: tile, roughness: 0.55 }))
  kitchen.rotation.x = -Math.PI / 2; kitchen.position.set((fx0 + fx1) / 2, 0, fz0 + 3.2); kitchen.receiveShadow = true
  root.add(kitchen)
  const wood = tex(256, 256, (g, w) => {
    g.fillStyle = '#9b6a43'; g.fillRect(0, 0, w, w)
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#8e5f3b' : '#a5734a'; g.fillRect(0, i * 32, w, 31)
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(((i * 97) % 200) + 20, i * 32, 3, 31)
    }
  })
  wood.wrapS = wood.wrapT = THREE.RepeatWrapping; wood.repeat.set((fx1 - fx0) / 2.4, (fz1 - fz0 - 6.4) / 2.4)
  const hall = new THREE.Mesh(new THREE.PlaneGeometry(fx1 - fx0, fz1 - fz0 - 6.4), std(0xffffff, { map: wood }))
  hall.rotation.x = -Math.PI / 2; hall.position.set((fx0 + fx1) / 2, 0.001, fz0 + 6.4 + (fz1 - fz0 - 6.4) / 2); hall.receiveShadow = true
  root.add(hall)
  // 外の地面
  const out = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), std(0x8b8f86))
  out.rotation.x = -Math.PI / 2; out.position.set(0, -0.01, fz1 + 15); root.add(out)
  // 窓の外の町並み（奥行き）
  const bcol = [0xd9c7a8, 0xbfcad6, 0xe3d2c0, 0xa9b8a3, 0xd6b8a0]
  const winM = new THREE.MeshBasicMaterial({ color: 0x8fb3c9 })
  for (let i = 0; i < 9; i++) {
    const w = 3 + (i * 37 % 4), h = 4 + (i * 53 % 6)
    const b = box(w, h, 4, std(bcol[i % 5]), -16 + i * 4.2, h / 2, fz1 + 14 + (i % 3))
    b.castShadow = false; root.add(b)
    for (let k = 0; k < Math.floor(h / 1.6); k++) { const wn = box(w * 0.7, 0.5, 0.05, winM, b.position.x, 1 + k * 1.5, b.position.z - 2.03); wn.castShadow = false; root.add(wn) }
  }
  for (let i = 0; i < 6; i++) {
    const t = cyl(0.12, 0.16, 1.6, std(0x6b4a2e)); t.position.set(-12 + i * 5, 0.8, fz1 + 6); root.add(t)
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 10), std(0x5c9a4f)); leaf.position.set(-12 + i * 5, 2.3, fz1 + 6); root.add(leaf)
  }

  // 壁と天井
  const H = 3.2
  const wallM = std(0xf1e6d2), backM = std(0xe6efe9)
  root.add(box(fx1 - fx0, H, 0.2, backM, (fx0 + fx1) / 2, H / 2, fz0 - 0.1))
  root.add(box(0.2, H, fz1 - fz0, wallM, fx0 - 0.1, H / 2, (fz0 + fz1) / 2))
  root.add(box(0.2, H, fz1 - fz0, wallM, fx1 + 0.1, H / 2, (fz0 + fz1) / 2))
  // 正面の壁（ドアと窓）
  const [dx] = L.door
  const glass = new THREE.MeshStandardMaterial({ color: 0xbfe3ff, emissive: 0x9fd0f0, emissiveIntensity: 0.55, roughness: 0.1, transparent: true, opacity: 0.55 })
  for (const [a, b] of [[fx0, dx - 1], [dx + 1, fx1]]) {
    root.add(box(b - a, 0.9, 0.2, wallM, (a + b) / 2, 0.45, fz1 + 0.1))
    root.add(box(b - a, 0.7, 0.2, wallM, (a + b) / 2, H - 0.35, fz1 + 0.1))
    const g = new THREE.Mesh(new THREE.PlaneGeometry(b - a - 0.3, 1.6), glass); g.position.set((a + b) / 2, 1.7, fz1 + 0.05); g.rotation.y = Math.PI; root.add(g)
  }
  root.add(box(2, 0.7, 0.2, wallM, dx, H - 0.35, fz1 + 0.1))
  // 下の帯（腰壁）
  root.add(box(fx1 - fx0, 0.12, 0.05, std(0x3c6e5a), (fx0 + fx1) / 2, 1.0, fz0 + 0.02))
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(fx1 - fx0, fz1 - fz0), std(0xfaf6ef, { emissive: 0x9a9080 }))
  ceil.rotation.x = Math.PI / 2; ceil.position.set((fx0 + fx1) / 2, H, (fz0 + fz1) / 2); root.add(ceil)
  // 照明（見た目だけの板）
  const lampM = new THREE.MeshBasicMaterial({ color: 0xfff4d8 })
  for (const [x, z] of [[-4, -2.5], [0, -2.5], [4, -2.5], [-3, 5], [3, 5], [0, 8]]) { const l = box(1.6, 0.05, 0.3, lampM, x, H - 0.03, z); l.castShadow = false; root.add(l) }

  // カウンター
  const c = L.counter
  const counterM = std(0x7a4a2c), topM = std(0xd8b98f, { roughness: 0.5 })
  root.add(box(c.x1 - c.x0, 0.95, c.z1 - c.z0, counterM, (c.x0 + c.x1) / 2, 0.475, (c.z0 + c.z1) / 2))
  root.add(box(c.x1 - c.x0 + 0.06, 0.06, c.z1 - c.z0 + 0.16, topM, (c.x0 + c.x1) / 2, 0.98, (c.z0 + c.z1) / 2))
  // 客の待つ場所の印（床の丸）
  const spotM = new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.35 })
  for (const [x, z] of L.spots) { const s = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.42, 28), spotM); s.rotation.x = -Math.PI / 2; s.position.set(x, 0.01, z); root.add(s) }
  // 客席の机と椅子
  for (const [x, z, w, d] of L.tables) {
    root.add(box(w, 0.06, d, topM, x, 0.74, z))
    root.add(box(0.12, 0.72, 0.12, counterM, x, 0.36, z))
  }
  for (const [x, z] of L.seats) { root.add(box(0.42, 0.06, 0.42, std(0x3c6e5a), x, 0.45, z)); root.add(box(0.06, 0.45, 0.06, counterM, x, 0.22, z)) }
  // 店名の看板
  const sign = textPlane(shop.name, { w: 2.6, h: 0.6, bg: '#3c6e5a', fg: '#fff6df' })
  sign.position.set(0, 2.55, fz0 + 0.02); root.add(sign)
  const sign2 = textPlane(shop.name, { w: 2.2, h: 0.5, bg: '#3c6e5a', fg: '#fff6df' })
  sign2.position.set(dx, 2.6, fz1 - 0.02); sign2.rotation.y = Math.PI; root.add(sign2)

  // 光
  scene.add(new THREE.HemisphereLight(0xfff6e6, 0xd8c8b0, 1.25), new THREE.AmbientLight(0xffffff, 0.35))
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.5)
  sun.position.set(3, 8, 6); sun.target.position.set(0, 0, 0)
  if (quality.shadows) {
    sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024)
    Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 25 })
    sun.shadow.bias = -0.0008
  }
  scene.add(sun, sun.target)

  // 設備
  const stations = {}
  for (const st of shop.stations) {
    if (st.upgrade && !upgrades[st.upgrade]) continue
    const g = buildStation(st)
    g.position.set(st.x, 0, st.z)
    g.traverse(o => { if (o.isMesh) o.userData.target = { k: 'st', id: st.id } })
    root.add(g)
    stations[st.id] = g
    // 看板（壁ぎわの設備は上に、作業台などは横に）
    const lb = textPlane(st.label, { w: 0.72, h: 0.18 })
    // 看板は目の高さより上に（近づいても視界をふさがない）
    lb.position.set(0, st.type === 'table' && st.z > -3 ? 2.05 : 2.2, st.type === 'table' && st.z > -3 ? 0 : -stationSize(st)[1] / 2 + 0.05)
    if (st.z > 0) lb.rotation.y = Math.PI
    g.add(lb)
    g.userData.label = lb
  }
  return { root, stations }
}

const metal = std(0x9aa3ab, { metalness: 0.6, roughness: 0.35 })
const dark = std(0x30343a, { metalness: 0.3, roughness: 0.5 })

function buildStation(st) {
  const g = new THREE.Group()
  const [w, d, h] = stationSize(st)
  switch (st.type) {
    case 'oven': {
      g.add(box(w, h, d, dark, 0, h / 2, 0))
      const win = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.7, h * 0.42), new THREE.MeshStandardMaterial({ color: 0x221a12, emissive: 0xff7a1a, emissiveIntensity: 0.0, roughness: 0.2 }))
      win.position.set(0, h * 0.5, d / 2 + 0.01); g.add(win); g.userData.window = win
      g.add(box(w * 0.75, 0.05, 0.06, metal, 0, h * 0.78, d / 2 + 0.04))
      for (const x of [-0.45, 0.45]) { const k = cyl(0.05, 0.05, 0.05, metal); k.rotation.x = Math.PI / 2; k.position.set(x, h * 0.9, d / 2 + 0.02); g.add(k) }
      break
    }
    case 'drinker': {
      const blue = std(0x2f6fb2, { roughness: 0.4 })
      g.add(box(w, 0.33, d, metal, 0, 0.165, 0))              // 台
      g.add(box(w, h - 0.33, d * 0.5, blue, 0, 0.33 + (h - 0.33) / 2, -d * 0.25)) // 本体（奥）
      g.add(box(w, 0.3, d * 0.5, blue, 0, h - 0.15, d * 0.25))  // 上のひさし
      g.add(box(w * 0.7, 0.42, 0.02, std(0x14202e), 0, 0.56, 0.005)) // 注ぎ口のくぼみ
      g.add(box(w * 0.6, 0.03, d * 0.4, std(0x222831), 0, 0.345, d * 0.2)) // 受け皿
      const noz = cyl(0.04, 0.03, 0.1, metal); noz.position.set(0, h - 0.35, 0.12); g.add(noz)
      const panel = box(w * 0.5, 0.14, 0.02, std(0x111111, { emissive: 0x3fa7ff, emissiveIntensity: 0.7 }), 0, h - 0.15, d / 2 + 0.005); g.add(panel)
      break
    }
    case 'doughbox': {
      g.add(box(w, h, d, std(0xb38755), 0, h / 2, 0))
      g.add(box(w * 0.86, 0.02, d * 0.86, std(0x5a3d22), 0, h - 0.01, 0))
      const balls = []
      for (let i = 0; i < 10; i++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), std(0xf3e2b8, { roughness: 0.9 }))
        b.scale.y = 0.65
        b.position.set(-0.22 + (i % 3) * 0.22, h + 0.05, -0.4 + Math.floor(i / 3) * 0.26)
        g.add(b); balls.push(b)
      }
      g.userData.balls = balls
      break
    }
    case 'crates': {
      const card = std(0xc79a62)
      g.add(box(0.6, 0.45, 0.5, card, -0.3, 0.225, 0.2), box(0.6, 0.45, 0.5, card, 0.32, 0.225, 0.22), box(0.6, 0.45, 0.5, card, 0, 0.675, 0.05), box(0.6, 0.45, 0.5, card, -0.3, 0.225, -0.3))
      break
    }
    case 'cups': {
      g.add(box(w, 0.8, d, std(0x7d8b93), 0, 0.4, 0))
      for (let i = 0; i < 4; i++) { const cu = cyl(0.09, 0.07, 0.15, std(0xffffff)); cu.position.set(-0.15 + (i % 2) * 0.3, 0.88, -0.12 + Math.floor(i / 2) * 0.24); g.add(cu) }
      break
    }
    case 'table': {
      g.add(box(w, 0.06, d, metal, 0, 0.87, 0))
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(box(0.06, 0.84, 0.06, metal, x * (w / 2 - 0.08), 0.42, z * (d / 2 - 0.08)))
      g.add(box(w - 0.1, 0.03, d - 0.1, metal, 0, 0.25, 0))
      // 置き場所の印
      for (const [sx, sz] of st.slots) { const r = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.15, 20), new THREE.MeshBasicMaterial({ color: 0x5c6670 })); r.rotation.x = -Math.PI / 2; r.position.set(sx, 0.905, sz); g.add(r) }
      break
    }
    case 'trash': {
      const b = cyl(0.28, 0.24, h, std(0x4c6a4f)); b.position.y = h / 2; g.add(b)
      const lid = cyl(0.3, 0.3, 0.04, std(0x2f4532)); lid.position.y = h; g.add(lid)
      break
    }
    case 'register': {
      g.add(box(w, 0.95, d, std(0x7a4a2c), 0, 0.475, 0))
      g.add(box(0.5, 0.18, 0.4, dark, 0, 1.05, 0))
      const scr = box(0.4, 0.25, 0.04, std(0x111111, { emissive: 0x2a8a4a, emissiveIntensity: 0.9 }), 0, 1.3, 0.12)
      scr.rotation.x = -0.4; scr.rotation.y = Math.PI; g.add(scr)
      break
    }
  }
  return g
}

// 焼き加減や注ぎ具合のゲージ（設備の上に浮かべる）。draw(v) で描き直す
export function makeGauge(width = 0.9) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 48
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 48 / 256), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthTest: false }))
  m.renderOrder = 5
  return {
    mesh: m,
    draw(bands, v, max) {
      const g = c.getContext('2d')
      g.clearRect(0, 0, 256, 48)
      g.fillStyle = 'rgba(20,16,12,.85)'; g.beginPath(); g.roundRect(0, 0, 256, 48, 12); g.fill()
      const X = s => 8 + (Math.min(s, max) / max) * 240
      g.fillStyle = '#4a4036'; g.fillRect(8, 12, 240, 24)
      for (const [a, b, col] of bands) { g.fillStyle = col; g.fillRect(X(a), 12, X(b) - X(a), 24) }
      g.fillStyle = '#fff'; g.fillRect(X(v) - 3, 4, 6, 40)
      t.needsUpdate = true
    }
  }
}

// ---- 品物
const breadColor = new THREE.Color()
export function itemMesh(type) {
  const g = new THREE.Group()
  if (type === 'dough' || type === 'bread') {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 12), std(0xf3e2b8, { roughness: 0.85 }))
    m.scale.set(1.25, 0.62, 0.9); m.castShadow = true; m.position.y = 0.08
    g.add(m); g.userData.body = m
  } else if (type === 'cup' || type === 'drink') {
    const cup = cyl(0.075, 0.06, 0.17, std(0xffffff, { roughness: 0.4 })); cup.position.y = 0.085; g.add(cup)
    const liq = cyl(0.07, 0.07, 0.01, std(0xb5562b, { roughness: 0.2 })); liq.position.y = 0.16; g.add(liq)
    const lid = cyl(0.08, 0.08, 0.02, std(0xe33e3e)); lid.position.y = 0.18; g.add(lid)
    g.userData.liq = liq; g.userData.lid = lid
  } else if (type === 'crate') {
    g.add(box(0.5, 0.36, 0.4, std(0xc79a62), 0, 0.18, 0))
    g.add(box(0.51, 0.06, 0.12, std(0xe8d3a8), 0, 0.33, 0))
  }
  return g
}
// 品物の見た目を状態に合わせる（焼き色・ドリンクの量）
export function paintItem(mesh, it, shop) {
  if (it.type === 'dough' || it.type === 'bread') {
    const b = mesh.userData.body
    const cook = it.type === 'dough' ? 0 : it.cook || 0
    const k = Math.min(1, cook / shop.bake.windows.normal[1])
    const burn = Math.max(0, Math.min(1, (cook - shop.bake.windows.well[1]) / (shop.bake.burnt - shop.bake.windows.well[1])))
    breadColor.setRGB(0.95 - 0.27 * k - 0.55 * burn, 0.88 - 0.42 * k - 0.36 * burn, 0.72 - 0.5 * k - 0.15 * burn)
    b.material.color.copy(breadColor)
    const sc = 1 + 0.25 * Math.min(1, cook / 6)
    b.scale.set(1.25 * sc, 0.62 * sc * (it.type === 'dough' ? 0.9 : 1.1), 0.9 * sc)
  } else if (it.type === 'cup' || it.type === 'drink') {
    const f = it.type === 'drink' ? 1 : it.fill || 0
    mesh.userData.liq.visible = f > 0.02
    mesh.userData.liq.scale.y = 1 + f * 14
    mesh.userData.liq.position.y = 0.01 + f * 0.075
    mesh.userData.lid.visible = it.type === 'drink'
  }
}

// ---- 人（客と店員）
const SKIN = [0xf6d2b0, 0xeab894, 0xd9a07a, 0xfbe0c8, 0xe6b48c, 0xcf9268]
const CLOTH = [0x4b7bd1, 0xd1574b, 0x5aa36b, 0x9a6bd1, 0xd1a24b, 0x3a3f4a]
const faces = {}
function faceTex(mood) {
  if (faces[mood]) return faces[mood]
  faces[mood] = tex(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128)
    g.lineCap = 'round'
    // 白目を付けて、肌の色が濃くても表情が読めるように
    for (const x of [42, 86]) {
      g.fillStyle = '#fff'; g.beginPath(); g.ellipse(x, 60, 12, 13, 0, 0, Math.PI * 2); g.fill()
      g.fillStyle = '#1a120c'; g.beginPath(); g.arc(x, 62, 7, 0, Math.PI * 2); g.fill()
    }
    g.strokeStyle = '#1a120c'; g.lineWidth = 7
    if (mood === 'angry') { g.beginPath(); g.moveTo(28, 40); g.lineTo(52, 48); g.moveTo(100, 40); g.lineTo(76, 48); g.stroke() }
    g.strokeStyle = '#7a1c1c'; g.lineWidth = 8
    g.beginPath()
    if (mood === 'happy') g.arc(64, 82, 20, 0.15 * Math.PI, 0.85 * Math.PI)
    else if (mood === 'ok') { g.moveTo(48, 92); g.lineTo(80, 92) }
    else if (mood === 'sad') g.arc(64, 106, 18, 1.15 * Math.PI, 1.85 * Math.PI)
    else { g.moveTo(46, 100); g.quadraticCurveTo(64, 82, 82, 100) }
    g.stroke()
    if (mood === 'sad' || mood === 'angry') { g.fillStyle = '#7cc8ff'; g.beginPath(); g.ellipse(104, 34, 7, 11, 0, 0, Math.PI * 2); g.fill() }
  })
  return faces[mood]
}

export function personMesh({ look = 0, color = null, staff = false }) {
  const g = new THREE.Group()
  const cloth = std(color ? new THREE.Color(color) : CLOTH[look % CLOTH.length])
  const skin = std(SKIN[(look * 5 + 1) % SKIN.length], { roughness: 0.8 })
  const cap = (r, l, mat) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 6, 12), mat); m.castShadow = true; return m }
  const legs = new THREE.Group()
  const pants = std([0x2d2f36, 0x3b4a6b, 0x5a4636][look % 3])
  for (const x of [-0.1, 0.1]) {
    // 脚は腰を支点に振る（中身を下にずらしておく）
    const l = new THREE.Group(); l.position.set(x, 0.8, 0)
    const m = cap(0.075, 0.62, pants); m.position.y = -0.38; l.add(m)
    const shoe = box(0.13, 0.08, 0.22, std(0x222222), 0, -0.76, 0.04); l.add(shoe)
    legs.add(l)
  }
  g.add(legs)
  const body = cap(0.23, 0.36, cloth); body.position.y = 1.12; body.scale.z = 0.72; g.add(body)
  if (staff) { const ap = box(0.36, 0.46, 0.02, std(0xf6f1e4), 0, 1.02, 0.17); g.add(ap) }
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), skin); head.position.y = 1.62; head.castShadow = true; g.add(head)
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.21, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), std([0x2a1a12, 0x6b3d1e, 0x1a1a1a, 0xc9a26b][look % 4]))
  hair.position.y = 1.65; g.add(hair)
  if (staff) { const cap = cyl(0.17, 0.2, 0.12, std(color ? new THREE.Color(color) : 0xffffff)); cap.position.y = 1.83; g.add(cap) }
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshBasicMaterial({ map: faceTex('happy'), transparent: true }))
  face.position.set(0, 1.6, 0.201); g.add(face)
  const arms = []
  for (const x of [-0.29, 0.29]) {
    const a = new THREE.Group(); a.position.set(x, 1.36, 0)
    const m = cap(0.06, 0.42, cloth); m.position.y = -0.24; a.add(m)
    const hnd = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), skin); hnd.position.y = -0.5; a.add(hnd)
    g.add(a); arms.push(a)
  }
  g.userData = { legs, arms, face, mood: 'happy', body }
  return g
}
export function setMood(person, mood) {
  if (person.userData.mood === mood) return
  person.userData.mood = mood
  person.userData.face.material.map = faceTex(mood)
  person.userData.face.material.needsUpdate = true
}

// 頭の上の札（注文・ひとこと）。Sprite で常にこちらを向く
export function makeBubble() {
  const c = document.createElement('canvas'); c.width = 320; c.height = 200
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }))
  s.renderOrder = 6
  s.scale.set(0.96, 0.6, 1)
  return { sprite: s, canvas: c, tex: t, key: '' }
}

// 品物の絵（注文票・吹き出し・画面の札で同じ絵を使う）
export function drawIcon(g, kind, x, y, s, opt) {
  g.save(); g.translate(x, y); g.scale(s / 64, s / 64)
  if (kind === 'bread') {
    g.fillStyle = opt === 'well' ? '#8a4f1f' : '#d79a4e'
    g.beginPath(); g.ellipse(0, 6, 26, 17, 0, 0, Math.PI * 2); g.fill()
    g.strokeStyle = 'rgba(255,240,210,.8)'; g.lineWidth = 3.5; g.lineCap = 'round'
    for (const dx of [-10, 0, 10]) { g.beginPath(); g.moveTo(dx - 4, 0); g.lineTo(dx + 4, -4); g.stroke() }
  } else if (kind === 'drink') {
    g.fillStyle = '#fff'; g.strokeStyle = '#3b2f25'; g.lineWidth = 4; g.beginPath(); g.moveTo(-15, -18); g.lineTo(15, -18); g.lineTo(11, 24); g.lineTo(-11, 24); g.closePath(); g.fill(); g.stroke()
    g.fillStyle = '#e33e3e'; g.fillRect(-17, -24, 34, 7)
    g.strokeStyle = '#e33e3e'; g.lineWidth = 4; g.beginPath(); g.moveTo(4, -24); g.lineTo(10, -34); g.stroke()
    g.fillStyle = '#b5562b'; g.fillRect(-12, -6, 24, 10)
  } else if (kind === 'pay') {
    g.fillStyle = '#ffd36b'; g.beginPath(); g.arc(0, 0, 22, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#7a5a10'; g.font = '800 26px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('¥', 0, 2)
  }
  g.restore()
}
