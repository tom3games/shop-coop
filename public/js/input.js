// 操作。PC は WASD＋マウス（クリックで視点を固定）＋E かクリックで「使う」、Shift で走る。
// スマホは左半分のどこでも指を置くとスティックが出る（移動）、右半分をなぞると視点、右下の手のボタンで「使う」。
// 走るボタンは押すたびに入／切が切り替わる（押し続けなくてよい）。
export function createInput(el, { onUse, onMenu, isActive }) {
  const st = { mx: 0, my: 0, lookX: 0, lookY: 0, run: false, runHeld: false, keys: new Set(), locked: false, touch: false }
  const KEYS = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' }

  const onKey = e => {
    if (!isActive()) return
    if (e.target && e.target.tagName === 'INPUT') return
    const k = KEYS[e.code]
    if (k) { e.preventDefault(); if (e.type === 'keydown') st.keys.add(k); else st.keys.delete(k) }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') st.runHeld = e.type === 'keydown'
    if (e.type === 'keydown' && !e.repeat) {
      if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); onUse() }
      if (e.code === 'KeyR') setRun(!st.run)
      if (e.code === 'Escape' || e.code === 'KeyP') onMenu()
    }
  }
  addEventListener('keydown', onKey)
  addEventListener('keyup', onKey)
  addEventListener('blur', () => { st.keys.clear(); st.runHeld = false })

  // マウス: 視点を固定（ポインターロック）してから動かす。固定中の左クリックは「使う」
  el.addEventListener('mousedown', e => {
    if (!isActive() || st.touch) return
    if (!st.locked) { el.requestPointerLock?.(); return }
    if (e.button === 0) onUse()
  })
  document.addEventListener('pointerlockchange', () => { st.locked = document.pointerLockElement === el })
  addEventListener('mousemove', e => { if (st.locked && isActive()) { st.lookX += e.movementX * 0.0024; st.lookY += e.movementY * 0.0024 } })

  // タッチ
  const stick = document.getElementById('stick'), knob = document.getElementById('stickKnob')
  let moveId = null, lookId = null, sx = 0, sy = 0, lx = 0, ly = 0
  const R = 56
  el.addEventListener('touchstart', e => {
    st.touch = true
    if (!isActive()) return
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.45 && moveId === null) {
        moveId = t.identifier; sx = t.clientX; sy = t.clientY
        stick.hidden = false; stick.style.left = sx + 'px'; stick.style.top = sy + 'px'; knob.style.transform = ''
      } else if (lookId === null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY }
    }
    e.preventDefault()
  }, { passive: false })
  el.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier === moveId) {
        let dx = t.clientX - sx, dy = t.clientY - sy
        const m = Math.hypot(dx, dy)
        if (m > R) { dx *= R / m; dy *= R / m }
        knob.style.transform = `translate(${dx}px, ${dy}px)`
        const k = Math.hypot(dx, dy) / R
        st.mx = k < 0.12 ? 0 : dx / R; st.my = k < 0.12 ? 0 : -dy / R
      } else if (t.identifier === lookId) {
        st.lookX += (t.clientX - lx) * 0.0062; st.lookY += (t.clientY - ly) * 0.0062
        lx = t.clientX; ly = t.clientY
      }
    }
    e.preventDefault()
  }, { passive: false })
  const end = e => {
    for (const t of e.changedTouches) {
      if (t.identifier === moveId) { moveId = null; st.mx = 0; st.my = 0; stick.hidden = true }
      if (t.identifier === lookId) lookId = null
    }
  }
  el.addEventListener('touchend', end)
  el.addEventListener('touchcancel', end)

  const runBtn = document.getElementById('runBtn')
  function setRun(v) { st.run = v; runBtn.setAttribute('aria-pressed', v ? 'true' : 'false') }
  runBtn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); setRun(!st.run) })
  const useBtn = document.getElementById('useBtn')
  useBtn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); onUse() })

  return {
    st,
    // 前後左右（-1〜1）と、走っているか
    move() {
      let x = st.mx, y = st.my
      if (st.keys.size) {
        x = (st.keys.has('r') ? 1 : 0) - (st.keys.has('l') ? 1 : 0)
        y = (st.keys.has('f') ? 1 : 0) - (st.keys.has('b') ? 1 : 0)
        const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m }
      }
      return { x, y, run: st.run || st.runHeld }
    },
    takeLook() { const d = [st.lookX, st.lookY]; st.lookX = 0; st.lookY = 0; return d },
    reset() { st.keys.clear(); st.mx = st.my = 0; moveId = lookId = null; stick.hidden = true; setRun(false) },
    unlock() { if (document.pointerLockElement) document.exitPointerLock?.() },
    setRun
  }
}
