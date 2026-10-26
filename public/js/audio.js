// 効果音と BGM。全部その場で合成する（音声ファイルなし）。最初に画面を触るまで鳴らない（ブラウザの決まり）。
// 鳴らす音は絞る: 注文・焼けた・焦げそう・渡した・会計・怒った・時間帯の切り替わり。画面を見ていなくても状況が分かる最小限
const KEY = 'shop-mute'
let ctx = null, master = null, music = null, muted = false, bgmOn = false, step = 0, nextT = 0, tempo = 100, noiseBuf = null
try { muted = localStorage.getItem(KEY) === '1' } catch {}

export function unlock() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return }
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return
  try {
    ctx = new AC()
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.6; master.connect(ctx.destination)
    music = ctx.createGain(); music.gain.value = 0.28; music.connect(master)
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    setInterval(schedule, 50)
  } catch { ctx = null }
}
addEventListener('pointerdown', unlock, { passive: true })
addEventListener('keydown', unlock)

export const isMuted = () => muted
export function setMuted(m) {
  muted = m
  try { localStorage.setItem(KEY, m ? '1' : '0') } catch {}
  if (master) master.gain.value = m ? 0 : 0.6
}

function tone(f, dur, { type = 'triangle', vol = 0.15, at = 0, to = 0, dest } = {}) {
  if (!ctx) return
  const t = ctx.currentTime + at
  const o = ctx.createOscillator(), g = ctx.createGain()
  o.type = type; o.frequency.setValueAtTime(f, t)
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur)
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g); g.connect(dest || master); o.start(t); o.stop(t + dur + 0.02)
}
function noise(dur, vol, freq, { at = 0, type = 'bandpass', dest } = {}) {
  if (!ctx) return
  const t = ctx.currentTime + at
  const s = ctx.createBufferSource(); s.buffer = noiseBuf
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  s.connect(f); f.connect(g); g.connect(dest || master); s.start(t, Math.random() * 0.5, dur + 0.05)
}

export const sfx = {
  click() { tone(900, 0.05, { type: 'square', vol: 0.05 }) },
  nope() { tone(220, 0.12, { type: 'square', vol: 0.06 }); tone(180, 0.14, { type: 'square', vol: 0.06, at: 0.1 }) },
  pick() { tone(520, 0.07, { vol: 0.12, to: 760 }) },
  put() { tone(420, 0.08, { vol: 0.12, to: 300 }); noise(0.05, 0.1, 1200) },
  order() { tone(1320, 0.5, { type: 'sine', vol: 0.12 }); tone(1760, 0.6, { type: 'sine', vol: 0.08, at: 0.12 }) },
  baked() { for (let i = 0; i < 2; i++) tone(1046, 0.1, { type: 'square', vol: 0.07, at: i * 0.16 }) },
  burnt() { for (let i = 0; i < 4; i++) tone(740, 0.09, { type: 'sawtooth', vol: 0.06, at: i * 0.13 }) },
  brewed() { tone(880, 0.25, { type: 'sine', vol: 0.12 }) },
  serve(q) { if (q >= 80) { tone(784, 0.12, { vol: 0.14 }); tone(1175, 0.2, { vol: 0.12, at: 0.08 }) } else tone(392, 0.25, { vol: 0.12, to: 330 }) },
  pay() { tone(1568, 0.08, { type: 'square', vol: 0.06 }); tone(2093, 0.25, { type: 'square', vol: 0.06, at: 0.07 }); noise(0.15, 0.08, 6000, { at: 0.02, type: 'highpass' }) },
  angry() { tone(160, 0.35, { type: 'sawtooth', vol: 0.09, to: 110 }) },
  impatient() { tone(300, 0.15, { type: 'triangle', vol: 0.08, to: 240 }) },
  refill() { noise(0.25, 0.2, 400); tone(300, 0.15, { vol: 0.1, at: 0.05 }) },
  trash() { noise(0.2, 0.18, 800) },
  phase() { [523, 659, 784].forEach((f, i) => tone(f, 0.22, { type: 'square', vol: 0.07, at: i * 0.1 })) },
  close() { [784, 659, 523, 392].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.12, at: i * 0.16 })) },
  win() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.12, at: i * 0.11 })) },
  step() { noise(0.04, 0.04, 300 + Math.random() * 200, { type: 'lowpass' }) }
}

// BGM: 軽いボサノバ風の刻み。忙しくなるとテンポが上がる
const CH = [[220, 277, 330], [196, 247, 294], [175, 220, 262], [196, 247, 330]]
export function bgm(on, busy = 0) { bgmOn = on; tempo = 96 + busy * 26 }
function schedule() {
  if (!ctx || !bgmOn || muted || document.hidden) { if (ctx) nextT = ctx.currentTime + 0.05; return }
  const s16 = 60 / tempo / 4
  if (nextT < ctx.currentTime) nextT = ctx.currentTime + 0.05
  while (nextT < ctx.currentTime + 0.2) {
    const i = step++ % 64, bar = Math.floor(i / 16), n = i % 16
    const at = nextT - ctx.currentTime
    const ch = CH[bar]
    if (n === 0 || n === 10) tone(ch[0] / 2, 0.35, { type: 'sine', vol: 0.22, at, dest: music })
    if (n === 6 || n === 14) tone(ch[0] / 2 * 1.5, 0.25, { type: 'sine', vol: 0.15, at, dest: music })
    if ([3, 6, 10, 13].includes(n)) for (const f of ch) tone(f, 0.16, { type: 'triangle', vol: 0.035, at, dest: music })
    if (n % 2 === 0) noise(0.03, 0.05, 7000, { at, type: 'highpass', dest: music })
    if (n === 4 || n === 12) noise(0.06, 0.06, 2500, { at, dest: music })
    nextT += s16
  }
}

export const ICON_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>'
export const ICON_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9l6 6M22 9l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
