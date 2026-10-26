// このブラウザだけの記録（名前・店の貯金・買った設備・自己ベスト）。localStorage が使えない環境でも動く
import { UPGRADES, LOCATIONS, DEFAULT_LOCATION } from '../shared/shops/prototype.js'
const KEY = 'shop-coop-v1'
function fresh() { return { name: '', wallet: 0, upgrades: {}, best: {}, shifts: 0, location: DEFAULT_LOCATION } }
export function load() {
  let p = null
  try { p = JSON.parse(localStorage.getItem(KEY) || 'null') } catch {}
  const f = fresh()
  if (!p || typeof p !== 'object') return f
  p = { ...f, ...p }
  p.wallet = Math.max(0, Math.floor(Number(p.wallet) || 0))
  const up = {}; for (const k of Object.keys(UPGRADES)) if (p.upgrades?.[k] === true) up[k] = true
  p.upgrades = up
  if (!LOCATIONS[p.location]) p.location = DEFAULT_LOCATION
  if (!p.best || typeof p.best !== 'object') p.best = {}
  return p
}
export function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)) } catch {} }
