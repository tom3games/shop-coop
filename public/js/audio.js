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
  step() { noise(0.04, 0.04, 300 + Math.random() * 200, { type: 'lowpass' }) },
  // ラーメン屋の音
  boiled() { tone(1568, 0.09, { type: 'square', vol: 0.06 }); tone(1568, 0.09, { type: 'square', vol: 0.06, at: 0.14 }); tone(2093, 0.18, { type: 'square', vol: 0.06, at: 0.28 }) },
  tick() { tone(1318, 0.06, { type: 'square', vol: 0.04 }) },
  plate() { noise(0.35, 0.22, 900); noise(0.2, 0.12, 2400, { at: 0.08 }); tone(220, 0.12, { vol: 0.06, at: 0.05 }) },
  pour() { noise(0.45, 0.16, 600, { type: 'lowpass' }); tone(330, 0.3, { type: 'sine', vol: 0.04, to: 260 }) },
  drip() { tone(900, 0.06, { type: 'sine', vol: 0.1, to: 500 }); tone(820, 0.06, { type: 'sine', vol: 0.08, at: 0.1, to: 450 }) },
  chop() { for (let i = 0; i < 3; i++) noise(0.03, 0.18, 3000, { at: i * 0.07, type: 'highpass' }) },
  clink() { tone(2637, 0.15, { type: 'sine', vol: 0.06 }); tone(3136, 0.2, { type: 'sine', vol: 0.05, at: 0.05 }) },
  door() { tone(1046, 0.4, { type: 'sine', vol: 0.06 }); tone(784, 0.5, { type: 'sine', vol: 0.06, at: 0.18 }) }
}

// BGM: ヨナ抜き音階の三味線ふうの刻みと太鼓。忙しくなるとテンポが上がる
const SCALE = [220, 247, 277, 330, 370, 440, 494, 554, 659]
const MEL = [5, 4, 3, 4, 5, -1, 3, 2, 3, 2, 1, -1, 0, 1, 3, -1, 4, 5, 6, 5, 4, -1, 3, 4, 3, 2, 1, -1, 2, 1, 0, -1]
export function bgm(on, busy = 0) { bgmOn = on; tempo = 92 + busy * 30 }
function schedule() {
  if (!ctx || !bgmOn || muted || document.hidden) { if (ctx) nextT = ctx.currentTime + 0.05; return }
  const s8 = 60 / tempo / 2
  if (nextT < ctx.currentTime) nextT = ctx.currentTime + 0.05
  while (nextT < ctx.currentTime + 0.2) {
    const i = step++ % 32
    const at = nextT - ctx.currentTime
    const n = MEL[i]
    if (n >= 0) { const f = SCALE[n]; tone(f, 0.28, { type: 'triangle', vol: 0.07, at, dest: music }); tone(f * 2, 0.06, { type: 'square', vol: 0.015, at, dest: music }) }
    if (i % 4 === 0) tone(110, 0.25, { type: 'sine', vol: 0.22, at, to: 70, dest: music })   // 太鼓（ドン）
    if (i % 8 === 6) noise(0.05, 0.08, 2000, { at, dest: music })                              // 太鼓のふち（カッ）
    if (i % 2 === 1) noise(0.02, 0.03, 6000, { at, type: 'highpass', dest: music })
    nextT += s8
  }
}

export const ICON_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>'
export const ICON_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9l6 6M22 9l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
