// 画面の切り替え（タイトル → 部屋 → 営業 → 結果）と、保存データ。営業中の3Dは game.js に任せる。
import { online, local } from './net.js'
import { createGame } from './game.js'
import { load, save } from './save.js'
import { LOCATIONS, UPGRADES, SHOP } from '../shared/shops/prototype.js'
import { setMuted, isMuted, ICON_ON, ICON_OFF, unlock, sfx } from './audio.js'

const $ = s => document.querySelector(s)
const SCREENS = ['title', 'lobby', 'result', 'upgrades', 'howto']
const ERR = {
  not_found: 'その部屋は見つかりません。コードを確かめてください', full: 'その部屋は満員です（4人まで）', bad_name: '名前を入れてください（12文字まで）',
  not_host: '始められるのはホストだけです', closed: 'しばらく動きがなかったので部屋を閉じました', no_room: '部屋に入っていません'
}
const coarse = matchMedia('(pointer: coarse)').matches
const quality = { touch: coarse || 'ontouchstart' in window, low: coarse || Math.min(innerWidth, innerHeight) < 500 }
quality.shadows = !quality.low
document.body.dataset.touch = quality.touch ? '1' : '0'

const prof = load()
let net = null, room = null, you = null, back = 'title', appliedRound = null, roundKey = null
const params = new URLSearchParams(location.search)
const testDuration = Number(params.get('duration')) || undefined // 検証用に営業を短くする

const game = createGame({ quality, onLeave: () => leaveRoom() })

function show(name) {
  for (const s of SCREENS) $('#' + s).hidden = s !== name
  $('#screens').hidden = !name
  document.body.dataset.screen = name || 'game'
}
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 3200) }

// ---- つなぐ
function onMessage(m) {
  switch (m.t) {
    case 'welcome':
      you = m.id
      if (pending) { const f = pending; pending = null; f() }
      break
    case 'joined': if (net.kind === 'online') history.replaceState(null, '', '/r/' + m.code); break
    case 'room': room = m; you = m.you; render(); break
    case 'snap': game.onSnap(m); break
    case 'actr': game.onActr(m); break
    case 'error': if (m.code !== 'not_playing' && m.code !== 'cannot') toast(ERR[m.code] || 'エラー: ' + m.code); break
    case 'closed': toast(ERR.closed); leaveRoom(true); break
  }
}
let pending = null
function connectOnline(then) {
  if (net && net.kind === 'online') return then()
  net?.close()
  pending = then
  net = online({ onMessage, onStatus: s => { $('#net') && ($('#net').dataset.s = s) } })
}
function connectLocal(then) {
  net?.close()
  pending = then
  net = local({ onMessage, onStatus: () => {} })
}
const send = m => net && net.send(m)
function opts() { return { location: prof.location, upgrades: prof.upgrades, duration: testDuration } }

function leaveRoom(quiet) {
  game.stop()
  if (!quiet) send({ t: 'leave' })
  if (net?.kind === 'local') { net.close(); net = null }
  room = null
  history.replaceState(null, '', '/')
  renderTitle(); show('title')
}

// ---- 描く
function render() {
  if (!room) return
  const isHost = room.host === you
  if (room.phase === 'playing') {
    if (!game.running || roundKey !== room.code + room.round) {
      roundKey = room.code + room.round
      show(null)
      game.start({ room, you, send, solo: net.kind === 'local', hints: prof.shifts < 2 })
      $('#menuNote').textContent = net.kind === 'local' ? 'ひとりのときは休憩中も時間が止まる' : '部屋では休憩中も営業は続く'
    }
    return
  }
  game.stop()
  if (room.phase === 'lobby') {
    show('lobby')
    $('#roomCode').textContent = room.code
    $('#invite').value = `${location.origin}/r/${room.code}`
    $('#players').replaceChildren(...room.players.map(p => {
      const li = document.createElement('li')
      li.textContent = p.name
      if (p.id === room.host) li.append(badge('ホスト'))
      if (p.id === you) li.append(badge('あなた'))
      if (!p.connected) { li.append(badge('切断中')); li.classList.add('off') }
      return li
    }))
    renderLocs($('#lobbyLocs'), isHost ? prof.location : room.opts.location, isHost)
    $('#startBtn').hidden = !isHost
    $('#lobbyHint').textContent = isHost ? (room.players.length < 2 ? '招待URLを送るか、そのまま1人でも始められる' : 'そろったら営業開始') : 'ホストが始めるのを待っています'
  } else if (room.phase === 'result') {
    showResult(room.result, isHost)
  }
}
function badge(t) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = t; return b }

function renderLocs(box, cur, editable) {
  box.replaceChildren(...Object.entries(LOCATIONS).map(([id, l]) => {
    const b = document.createElement('button')
    b.type = 'button'; b.className = 'loc'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', id === cur ? 'true' : 'false')
    b.disabled = !editable && id !== cur
    b.innerHTML = `<b></b><small></small>`
    b.querySelector('b').textContent = l.name; b.querySelector('small').textContent = l.lead
    if (editable) b.onclick = () => { prof.location = id; save(prof); renderLocs(box, id, true) }
    return b
  }))
}

function renderTitle() {
  $('#name').value = prof.name
  renderLocs($('#locs'), prof.location, true)
  $('#wallet').textContent = `¥${prof.wallet.toLocaleString()}`
}

function showResult(r, isHost) {
  show('result')
  if (!r) return
  const key = (room?.code || '') + ':' + room?.round
  const best = prof.best[r.location]
  let bestText
  if (appliedRound !== key) {
    appliedRound = key
    prof.wallet += Math.max(0, r.profit)
    prof.shifts++
    const isBest = !best || r.profit > best
    if (isBest) prof.best[r.location] = r.profit
    save(prof)
    showResult.last = { best, isBest }
    if (isBest && r.profit > 0) sfx.win(); else sfx.close()
  }
  const { best: prevBest, isBest } = showResult.last || {}
  bestText = prevBest == null ? 'はじめての記録' : isBest ? `自己ベスト更新（前回まで ¥${prevBest.toLocaleString()}）` : `自己ベスト ¥${prevBest.toLocaleString()}（あと ¥${(prevBest - r.profit).toLocaleString()}）`
  $('#rLoc').textContent = `${r.location}の営業`
  const grade = r.satisfaction >= 80 ? '大繁盛' : r.satisfaction >= 60 ? '上出来' : r.satisfaction >= 40 ? 'なんとか' : 'てんやわんや'
  $('#rTitle').textContent = grade
  $('#rTitle').dataset.g = r.satisfaction >= 60 ? 'good' : r.satisfaction >= 40 ? 'mid' : 'bad'
  $('#rProfit').textContent = `¥${r.profit.toLocaleString()}`
  $('#rBest').textContent = bestText
  $('#rBest').dataset.best = isBest ? '1' : '0'
  const cell = (k, v) => { const d = document.createElement('div'); d.innerHTML = '<small></small><b></b>'; d.querySelector('small').textContent = k; d.querySelector('b').textContent = v; return d }
  $('#rGrid').replaceChildren(
    cell('売上', `¥${r.sales.toLocaleString()}`), cell('材料費', `¥${r.cost.toLocaleString()}`),
    cell('来た客', `${r.customers}人`), cell('会計まで', `${r.served}人`),
    cell('成功率', `${r.success}%`), cell('平均品質', `${r.quality}`),
    cell('満足度', `${r.satisfaction}`), cell('怒って帰った', `${r.angry + r.turned}人`)
  )
  $('#againBtn').hidden = !isHost
  $('#rHint').textContent = isHost ? '' : 'ホストが次を選ぶのを待っています'
  $('#wallet2').textContent = `¥${prof.wallet.toLocaleString()}`
}

function renderUpgrades() {
  $('#wallet2').textContent = `¥${prof.wallet.toLocaleString()}`
  $('#upList').replaceChildren(...Object.entries(UPGRADES).map(([id, u]) => {
    const row = document.createElement('div'); row.className = 'up'
    const own = prof.upgrades[id]
    row.innerHTML = '<div><b></b><small></small></div><button></button>'
    row.querySelector('b').textContent = u.name; row.querySelector('small').textContent = u.lead
    const b = row.querySelector('button')
    b.textContent = own ? '設置済み' : `¥${u.cost.toLocaleString()}`
    b.disabled = own || prof.wallet < u.cost
    b.className = own ? 'ghost' : 'primary'
    b.onclick = () => { if (prof.wallet < u.cost || own) return; prof.wallet -= u.cost; prof.upgrades[id] = true; save(prof); sfx.pay(); renderUpgrades() }
    return row
  }))
}

// ---- ボタン
const nameOk = () => { const n = $('#name').value.trim(); prof.name = n; save(prof); if (!n) toast(ERR.bad_name); return n }
$('#soloBtn').onclick = () => {
  unlock()
  const n = nameOk() || '店長'
  connectLocal(() => { send({ t: 'create', name: n, opts: opts() }); setTimeout(() => send({ t: 'start', opts: opts() }), 0) })
}
$('#createBtn').onclick = () => { unlock(); const n = nameOk(); if (!n) return; connectOnline(() => send({ t: 'create', name: n, opts: opts() })) }
$('#joinBtn').onclick = () => {
  unlock()
  const n = nameOk(); if (!n) return
  const code = $('#code').value.trim().toUpperCase()
  if (!/^[A-Z0-9]{4}$/.test(code)) return toast('参加コードは4文字です')
  connectOnline(() => send({ t: 'join', code, name: n }))
}
$('#startBtn').onclick = () => send({ t: 'start', opts: opts() })
$('#leaveBtn').onclick = () => leaveRoom()
$('#againBtn').onclick = () => send({ t: 'start', opts: opts() })
$('#toTitleBtn').onclick = () => leaveRoom()
$('#copyBtn').onclick = async () => {
  const url = $('#invite').value
  try {
    if (navigator.share && quality.touch) await navigator.share({ title: '仮の店', text: '一緒に店を回そう', url })
    else { await navigator.clipboard.writeText(url); toast('招待URLをコピーしました') }
  } catch { $('#invite').select(); toast('URLを長押ししてコピーしてください') }
}
$('#upBtn').onclick = () => { back = 'title'; renderUpgrades(); show('upgrades') }
$('#rUpBtn').onclick = () => { back = 'result'; renderUpgrades(); show('upgrades') }
$('#upBack').onclick = () => { if (back === 'result' && room?.phase === 'result') show('result'); else { renderTitle(); show('title') } }
$('#howBtn').onclick = () => { back = 'title'; show('howto') }
$('#howBack').onclick = () => { if (back === 'menu') { show(null); $('#menu').hidden = false } else { renderTitle(); show('title') } }
$('#menuHowBtn').onclick = () => { back = 'menu'; $('#menu').hidden = true; show('howto') }
const paintMute = () => { $('#muteBtn').innerHTML = isMuted() ? ICON_OFF : ICON_ON; $('#muteBtn').setAttribute('aria-label', isMuted() ? '音を出す' : '音を消す') }
$('#muteBtn').onclick = () => { setMuted(!isMuted()); paintMute() }
paintMute()

// 招待URL（/r/ABCD）で開いたらコード欄を埋める
const inv = location.pathname.match(/^\/r\/([A-Z0-9]{4})/i)
renderTitle()
show('title')
if (inv) { $('#code').value = inv[1].toUpperCase(); $('#joinBtn').classList.add('primary'); $('#name').focus() }
void SHOP
window.__boot = true
window.__app = { prof: () => prof, room: () => room }
