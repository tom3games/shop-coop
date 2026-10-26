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
const DUR = 75

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
async function drive(page, role) {
  const want = await page.evaluate(role => {
    const S = window.__shop, s = S.state(), me = s.players[S.you()]
    if (!me) return null
    const held = me.hold && s.items[me.hold]
    const wants = t => s.customers.find(c => c.st === 'order' && c.arrived && c.order.some(l => !l.done && l.p === t))
    const free = id => !s.stations[id].slots[0]
    let t = null
    if (held) {
      if (held.type === 'dough' && free('oven1')) t = ['st', 'oven1']
      else if (held.type === 'cup' && free('drink1')) t = ['st', 'drink1']
      else if (held.type === 'bread' || held.type === 'drink') { const c = wants(held.type); t = c ? ['cu', c.id] : ['st', 'island'] }
    } else {
      if (s.customers.some(c => c.st === 'pay' && c.payIdx === 0 && c.arrived)) t = ['st', 'register']
      else if (role === 'bread') {
        const b = s.stations.oven1.slots[0] && s.items[s.stations.oven1.slots[0]]
        if (b && b.cook >= 7) t = ['st', 'oven1']
        else if (!b && wants('bread')) t = ['st', 'dough']
      } else if (role === 'drink') {
        const d = s.stations.drink1.slots[0] && s.items[s.stations.drink1.slots[0]]
        if (d && d.type === 'drink') t = ['st', 'drink1']
        else if (!d && wants('drink')) t = ['st', 'cups']
      }
      if (!t) for (const id of s.stations.island.slots) { const it = id && s.items[id]; if (it && wants(it.type)) { t = ['it', id]; break } }
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
    return { did: a.kind, want, tg }
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
  check((await host.title()).includes('仮の店'), `${bname}: 題名`)
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

  // 営業: ホスト=パン、横持ち=ドリンク。縦持ち=会計の手伝い
  const log = { host: [], g1: [], g2: [] }
  let shotGame = false
  const t0 = Date.now()
  while (Date.now() - t0 < (DUR + 25) * 1000) {
    const st = await host.evaluate(() => window.__app.room()?.phase)
    if (st === 'result') break
    const [a, b, c] = await Promise.all([drive(host, 'bread'), drive(g1, 'drink'), drive(g2, 'pay')])
    for (const [k, v] of [['host', a], ['g1', b], ['g2', c]]) if (v) log[k].push(v.did || 'miss')
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
  check(did('host').includes('take') && did('host').includes('put'), `${bname}: ホストが照準で 取る・焼く ができた`)
  check([...did('host'), ...did('g1'), ...did('g2')].includes('serve'), `${bname}: 客に渡せた`)
  check([...did('host'), ...did('g1'), ...did('g2')].includes('pay'), `${bname}: 会計できた`)
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
