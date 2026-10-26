// 手早い確認: ひとりで営業を開いてスクショとコンソールを集める
import { chromium } from 'playwright'
import { startServer } from '../server.mjs'
const srv = await startServer({ port: 0, quiet: true })
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const [w, h] = (process.env.SIZE || '1280x720').split('x').map(Number)
const touch = process.env.TOUCH === '1'
const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: 'ja-JP', hasTouch: touch, isMobile: touch })
const p = await ctx.newPage()
const errs = []
p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('requestfailed', r => errs.push('fail ' + r.url()))
await p.goto(`http://localhost:${srv.port}/?duration=${process.env.DUR || 120}`)
await p.waitForFunction(() => window.__boot)
await p.screenshot({ path: 'tools/shots/smoke-title.png' })
await p.fill('#name', 'テスト')
await p.click('#soloBtn')
await p.waitForFunction(() => window.__shop && window.__shop.state())
await p.waitForTimeout(Number(process.env.WAIT || 9000))
await p.screenshot({ path: 'tools/shots/smoke-game.png' })
console.log(JSON.stringify(await p.evaluate(() => ({ t: __shop.state().t, cust: __shop.state().customers.length, me: __shop.me(), act: __shop.action() }))))
console.log('errors', errs)
await b.close(); await srv.close()
