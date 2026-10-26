// 公開URL（トンネル）で確かめる: OGP、2人（chromium と webkit のスマホ）で作成→参加→営業→操作→結果
// 使い方: node tools/live.mjs https://xxxx.trycloudflare.com
import { chromium, webkit } from 'playwright'
const base = process.argv[2].replace(/\/$/, '')
let fail = 0
const check = (ok, l) => { console.log(ok ? 'OK  ' : 'NG  ', l); if (!ok) fail++ }
const cb = await chromium.launch(), wb = await webkit.launch()
const errors = []
const mk = async (b, vp, touch) => { const p = await (await b.newContext({ viewport: vp, locale: 'ja-JP', hasTouch: touch, isMobile: touch && b === cb })).newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type() === 'error' && errors.push(m.text())); return p }
const host = await mk(cb, { width: 1280, height: 720 }, false)
const html = await (await host.request.get(base + '/')).text()
const og = html.match(/property="og:image" content="([^"]+)"/)?.[1]
check(og && og.startsWith('https://') && og.endsWith('/og.png'), `og:image が絶対URL ${og}`)
const img = await host.request.get(og)
check(img.status() === 200 && (await img.body()).length > 50000, `og.png が取れる ${img.status()}`)
await host.goto(base + '/?duration=45')
await host.waitForFunction(() => window.__boot)
await host.fill('#name', 'ホスト'); await host.click('#createBtn')
await host.waitForSelector('#lobby:not([hidden])')
const inv = await host.inputValue('#invite')
check(inv.startsWith(base + '/r/'), `招待URL ${inv}`)
const g = await mk(wb, { width: 844, height: 390 }, true)
await g.goto(inv); await g.waitForFunction(() => window.__boot)
await g.fill('#name', 'iPhone'); await g.click('#joinBtn')
await host.waitForFunction(() => document.querySelectorAll('#players li').length === 2)
check(true, '2人目（webkit）が招待URLで入れる')
await host.click('#startBtn')
await g.waitForFunction(() => window.__shop && window.__shop.state() && window.__shop.me())
// webkit 側で生地を取ってオーブンに入れる（本物の照準で）
await g.waitForTimeout(800)
for (const t of [['st', 'noodles'], ['st', 'boiler1']]) {
  await g.evaluate(t => __shop.aimAt(t[0], t[1]), t); await g.waitForTimeout(200)
  const a = await g.evaluate(() => { const a = __shop.action(); __shop.use(); return a && a.kind })
  await g.waitForTimeout(600)
  check(a === (t[1] === 'noodles' ? 'take' : 'put'), `webkit: ${t[1]} で ${a}`)
}
const seen = await host.evaluate(() => __shop.state().stations.boiler1.slots.filter(Boolean).length)
check(seen === 1, 'ホストの画面でも茹で釜に麺が入っている')
check((await host.title()).includes('ラーメン'), `題名 ${await host.title()}`)
await host.waitForSelector('#result:not([hidden])', { timeout: 90000 })
await g.waitForSelector('#result:not([hidden])', { timeout: 30000 })
check(true, '2人とも結果画面')
await g.screenshot({ path: 'tools/shots/live-webkit-result.png' })
check(errors.length === 0, `コンソールエラーなし ${errors.join(' | ')}`)
await cb.close(); await wb.close()
console.log(fail ? `NG ${fail}` : 'ALL OK')
