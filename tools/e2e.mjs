// 実ブラウザ（chromium と webkit）で3人つないで、作成→招待URLで参加→営業→本物の照準と「使う」で 焼く・注ぐ・渡す・会計→結果 を通す。
// あわせて、各画面が スマホ縦・横 / PC の大きさで一画面に収まり、ボタンが画面内で 44px 以上あるかを数値で確かめる。スクショは tools/shots/
// 使い方: node tools/e2e.mjs [chromium|webkit]
import { chromium, webkit } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { startServer } from '../server.mjs'

const SHOTS = new URL('./shots/', import.meta.url).pathname
await mkdir(SHOTS, { recursive: true })
const srv = await startServer({ port: 0, quiet: true })
const base = `http://localhost:${srv.port}`
let fail = 0
const check = (ok, label) => { console.log(ok ? 'OK  ' : 'NG  ', label); if (!ok) fail++ }
const SIZES = [[390, 844], [360, 640], [844, 390], [667, 375], [1280, 720]]
const DUR = 95

async function fits(page, label, sizes = SIZES) {
  const orig = page.viewportSize()
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h })
    await page.waitForTimeout(300)
    const r = await page.evaluate(() => {
      const de = document.documentElement, bad = []
      const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
      for (const b of document.querySelectorAll('button, input')) {
        if (!vis(b) || b.closest('[hidden]')) continue
        if (getComputedStyle(b).display === 'none' || b.offsetParent === null && getComputedStyle(b).position !== 'fixed') continue
        const rc = b.getBoundingClientRect()
        const name = (b.id || b.textContent.trim()).slice(0, 10)
        if (rc.bottom > innerHeight + 1 || rc.right > innerWidth + 1 || rc.top < -1 || rc.left < -1) bad.push(name + ' 画面外')
        else if (rc.height < 43.5 || rc.width < 43.5) bad.push(name + ` ${Math.round(rc.width)}x${Math.round(rc.height)}`)
      }
      // 営業中の部品どうしが重なっていないか
      const pick = s => { const e = document.querySelector(s); return e && vis(e) && !e.closest('[hidden]') ? e.getBoundingClientRect() : null }
      const hit = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1
      const parts = ['.t-btns', '#hint', '#held', '#orders', '.h-right', '.h-clock', '#prompt']
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
        const a = pick(parts[i]), b = pick(parts[j])
        if (parts[i] === '#orders' && a && a.width === 0) continue
        if (hit(a, b)) bad.push(`${parts[i]}と${parts[j]}が重なる`)
      }
      const card = document.querySelector('#screens:not([hidden]) .card:not([hidden])')
      const cr = card && card.getBoundingClientRect()
      if (cr && (cr.bottom > innerHeight + 1 || cr.top < -1)) bad.push('カードがはみ出す')
      if (card && card.scrollHeight > card.clientHeight + 2) bad.push(`カードの中身が切れる ${card.scrollHeight}/${card.clientHeight}`)
      return { sh: Math.max(de.scrollHeight, document.body.scrollHeight), sw: de.scrollWidth, ih: innerHeight, iw: innerWidth, bad }
    })
    check(r.sh <= r.ih + 1 && r.sw <= r.iw + 1 && r.bad.length === 0, `${label} ${w}x${h}: 一画面に収まる（${r.sh}/${r.ih}, ${r.sw}/${r.iw}）${r.bad.join(' / ')}`)
    await page.screenshot({ path: `${SHOTS}${label}-${w}x${h}.png` })
  }
  await page.setViewportSize(orig)
}

// 画面の中の店員を動かす: 状態を見て次にやることを決め、照準を合わせて「使う」を押す（本物の照準判定を通る）
// cook = 麺→茹で→丼→スープ→（味）→盛る→トッピング→出す / support = 会計・器を下げる・洗う・麺の補充
async function drive(page, role) {
  const want = await page.evaluate(role => {
    const S = window.__shop, s = S.state(), me = s.players[S.you()]
    if (!me) return null
    const it = me.hold && s.items[me.hold]
    const W = { kata: [5.0, 6.6], normal: [7.2, 8.8], yawa: [9.6, 11.4] }
    const waiting = s.customers.filter(c => c.st === 'order' && c.arrived && c.order.some(l => !l.done))
    const boilers = Object.values(s.stations).filter(x => x.type === 'boiler')
    const boiling = boilers.flatMap(b => b.slots.filter(Boolean).map(id => s.items[id]))
    let t = null
    if (it) {
      if (it.type === 'noodle') { const b = boilers.find(b => b.slots.includes(null)); if (b) t = ['st', b.id] }
      else if (it.type === 'dirty') t = ['st', 'sink']
      else if (it.type === 'crate') t = ['st', 'noodles']
      else if (it.type === 'bowl') {
        const c = waiting[0], l = c && c.order.find(l => !l.done)
        if (!c) t = null // 待っている客がいなければ持ったまま待つ
        else if (!it.soup) t = ['st', 'soup']
        else if (l.koi && !it.koi) t = ['st', 'tare']
        else if (l.oil && !it.oil) t = ['st', 'abura']
        else if (it.noodle == null) { const n = boiling.filter(n => n.cook >= W[l.hard || 'normal'][0] + 0.2).sort((a, b) => b.cook - a.cook)[0]; if (n) t = ['it', n.id] }
        else { const miss = ['negi', ...(l.top || [])].find(k => !it.top.includes(k)); t = miss ? ['st', miss] : ['cu', c.id] }
      }
    } else {
      if (role === 'support') {
        if (s.customers.some(c => c.st === 'pay' && c.payIdx === 0 && c.arrived)) t = ['st', 'register']
        else if (s.stations.noodles.stock <= 1) t = ['st', 'crates']
        else { const d = s.stations.counter.slots.find(Boolean); if (d) t = ['it', d] }
      } else {
        if (boiling.length < waiting.length && s.stations.noodles.stock > 0 && boilers.some(b => b.slots.includes(null))) t = ['st', 'noodles']
        else if (boiling.length && s.stations.bowls.stock > 0) t = ['st', 'bowls']
      }
    }
    if (t) S.aimAt(t[0], t[1])
    return t
  }, role)
  if (!want) return null
  await page.waitForTimeout(140)
  return page.evaluate(want => {
    const S = window.__shop, a = S.action(), tg = S.target()
    if (!a || a.none) return { miss: want, tg, a }
    S.use()
    return { did: a.kind, label: a.label, want, tg }
  }, want)
}

const which = process.argv[2]
for (const [bname, bt] of [['chromium', chromium], ['webkit', webkit]]) {
  if (which && which !== bname) continue
  const browser = await bt.launch(bname === 'chromium' ? { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } : {})
  const errors = []
  const mk = async (vp, touch) => {
    const ctx = await browser.newContext({ viewport: vp, locale: 'ja-JP', hasTouch: touch, isMobile: touch && bname === 'chromium' })
    const p = await ctx.newPage()
    p.on('pageerror', e => errors.push(e.message))
    p.on('console', m => m.type() === 'error' && errors.push(m.text()))
    p.on('requestfailed', r => errors.push('requestfailed ' + r.url()))
    return p
  }
  const host = await mk({ width: 1280, height: 720 }, false)
  const g1 = await mk({ width: 844, height: 390 }, true)
  const g2 = await mk({ width: 390, height: 844 }, true)
  await host.goto(`${base}/?duration=${DUR}`)
  await host.waitForFunction(() => window.__boot)
  check((await host.title()).includes('ラーメン'), `${bname}: 題名`)
  await fits(host, `${bname}-title`)
  await host.fill('#name', 'ホスト')
  await host.click('#createBtn')
  await host.waitForSelector('#lobby:not([hidden])')
  const invite = await host.inputValue('#invite')
  check(/\/r\/[A-Z0-9]{4}$/.test(invite), `${bname}: 招待URL ${invite}`)
  for (const [g, n] of [[g1, 'よこ'], [g2, 'たて']]) {
    await g.goto(invite)
    await g.waitForFunction(() => window.__boot)
    check((await g.inputValue('#code')) === invite.slice(-4), `${bname}: 招待URLでコードが入る（${n}）`)
    await g.fill('#name', n)
    await g.click('#joinBtn')
    await g.waitForSelector('#lobby:not([hidden])')
  }
  await host.waitForFunction(() => document.querySelectorAll('#players li').length === 3)
  check(true, `${bname}: 3人がロビーにそろう`)
  await fits(g2, `${bname}-lobby`)
  await host.click('#startBtn')
  for (const p of [host, g1, g2]) await p.waitForFunction(() => window.__shop && window.__shop.state() && window.__shop.me())
  check(true, `${bname}: 3人とも営業画面に入る`)
  await g1.waitForTimeout(1500)
  // 全員に同じ営業が届いているか（客の数・店員の数）
  const sync = await Promise.all([host, g1, g2].map(p => p.evaluate(() => ({ n: Object.keys(__shop.state().players).length, t: __shop.state().t }))))
  check(sync.every(x => x.n === 3), `${bname}: 3人とも店員3人が見える ${JSON.stringify(sync)}`)
  // 自分の歩きが他の画面に届く
  await g2.evaluate(() => { const m = __shop.me(); m.x = 2.0; m.z = -0.5 })
  await host.waitForTimeout(600)
  const seen = await host.evaluate(() => { const s = __shop.state(); return Object.values(s.players).find(p => p.name === 'たて') })
  check(seen && Math.abs(seen.x - 2.0) < 0.05 && Math.abs(seen.z + 0.5) < 0.05, `${bname}: 縦持ちの人の位置がホストに届く ${seen && [seen.x, seen.z]}`)

  // 営業: ホストと横持ち=作る係、縦持ち=会計・片付け係
  const log = { host: [], g1: [], g2: [] }
  let shotGame = false
  const t0 = Date.now()
  while (Date.now() - t0 < (DUR + 25) * 1000) {
    const st = await host.evaluate(() => window.__app.room()?.phase)
    if (st === 'result') break
    const [a, b, c] = await Promise.all([drive(host, 'cook'), drive(g1, 'cook'), drive(g2, 'support')])
    for (const [k, v] of [['host', a], ['g1', b], ['g2', c]]) if (v) { log[k].push(v.did ? v.label : 'miss'); if (!v.did && (log.m = (log.m || 0) + 1) <= 6) console.log('   外れ', k, JSON.stringify(v)) }
    const s = await host.evaluate(() => __shop.state() && __shop.state().stats)
    if (!shotGame && s && s.linesDone >= 1) {
      shotGame = true
      await g1.screenshot({ path: `${SHOTS}${bname}-play-844x390.png` })
      await g2.screenshot({ path: `${SHOTS}${bname}-play-390x844.png` })
      await host.screenshot({ path: `${SHOTS}${bname}-play-1280x720.png` })
      await fits(g1, `${bname}-game`, [[844, 390], [667, 375], [390, 844], [360, 640]])
    }
    await host.waitForTimeout(160)
  }
  const did = k => log[k].filter(x => x !== 'miss')
  const misses = Object.values(log).flat().filter(x => x === 'miss').length
  console.log(`   操作: ホスト ${did('host').join(',')}`)
  console.log(`         横 ${did('g1').join(',')}  縦 ${did('g2').join(',')}  外れ ${misses}`)
  const all = [...did('host'), ...did('g1'), ...did('g2')].join('/')
  for (const l of ['麺を茹でる', 'スープを入れる', '麺を盛る', 'ネギをのせる', '出す', '下げる', '洗う', '会計する']) check(all.includes(l), `${bname}: 照準で「${l}」ができた`)
  check(misses <= 6, `${bname}: 照準の外れが少ない（${misses}回）`)
  for (const p of [host, g1, g2]) await p.waitForSelector('#result:not([hidden])', { timeout: 30000 })
  const prof = await Promise.all([host, g1, g2].map(p => p.textContent('#rProfit')))
  check(prof.every(x => x === prof[0]) && prof[0].startsWith('¥'), `${bname}: 3人とも同じ結果 ${prof.join(' ')}`)
  const served = await host.evaluate(() => window.__app.room().result.served)
  check(served >= 1, `${bname}: 会計まで終えた客 ${served}人`)
  await fits(host, `${bname}-result`)
  await fits(g2, `${bname}-result-guest`, [[390, 844], [844, 390]])
  // もう一回: 同じ部屋でまた始まる
  await host.click('#againBtn')
  await g2.waitForFunction(() => window.__shop && window.__shop.state() && window.__shop.state().t < 3)
  check(true, `${bname}: もう一回で全員また営業に入る`)
  // 退出（2回押し）
  await g1.evaluate(() => document.querySelector('#menuBtn').click())
  await g1.click('#quitBtn'); await g1.click('#quitBtn')
  await g1.waitForSelector('#title:not([hidden])')
  await host.waitForFunction(() => Object.values(__shop.state().players).filter(p => !p.away).length === 2)
  check(true, `${bname}: 抜けた人が店から消える`)

  // ひとりで営業（通信なし）
  const solo = await mk({ width: 667, height: 375 }, true)
  await solo.goto(`${base}/?duration=40`)
  await solo.waitForFunction(() => window.__boot)
  await fits(solo, `${bname}-title-solo`, [[667, 375]])
  await solo.click('#soloBtn')
  await solo.waitForFunction(() => window.__shop && window.__shop.state())
  await solo.waitForTimeout(2500)
  await fits(solo, `${bname}-solo-game`, [[667, 375], [360, 640]])
  const tA = await solo.evaluate(() => __shop.state().t)
  await solo.evaluate(() => document.querySelector('#menuBtn').click())
  await solo.waitForTimeout(1200)
  const tB = await solo.evaluate(() => __shop.state().t)
  check(Math.abs(tB - tA) < 0.4, `${bname}: ひとりのときは休憩中に時間が止まる（${tA.toFixed(1)}→${tB.toFixed(1)}）`)
  await fits(solo, `${bname}-menu`, [[667, 375], [390, 844]])
  await solo.click('#resumeBtn')
  await solo.waitForSelector('#result:not([hidden])', { timeout: 60000 })
  check(true, `${bname}: ひとりで営業が結果まで行く`)
  const wallet = await solo.evaluate(() => window.__app.prof().shifts)
  check(wallet === 1, `${bname}: 記録が残る（営業回数 ${wallet}）`)

  check(errors.length === 0, `${bname}: コンソールエラーなし ${errors.slice(0, 5).join(' | ')}`)
  await browser.close()
}
await srv.close()
console.log(fail ? `\nNG ${fail}件` : '\nALL OK')
process.exit(fail ? 1 : 0)
