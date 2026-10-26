// 見た目の確認用: ひとりで営業して、生地を持つ・焼く・客に向く を撮る。SIZE=844x390 TOUCH=1 で大きさを変える
import { chromium, webkit } from 'playwright'
import { startServer } from '../server.mjs'
const srv = await startServer({ port: 0, quiet: true })
const bt = process.env.BR === 'webkit' ? webkit : chromium
const b = await bt.launch(process.env.BR === 'webkit' ? {} : { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const [w, h] = (process.env.SIZE || '1280x720').split('x').map(Number)
const touch = process.env.TOUCH === '1'
const tag = process.env.TAG || `${w}x${h}`
const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: 'ja-JP', hasTouch: touch, isMobile: touch && bt === chromium })
const p = await ctx.newPage()
const errs = []
p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()))
await p.goto(`http://localhost:${srv.port}/?duration=300`)
await p.waitForFunction(() => window.__boot)
await p.click('#soloBtn')
await p.waitForFunction(() => window.__shop && window.__shop.state())
await p.waitForFunction(() => __shop.state().customers.some(c => c.st === 'order' && c.arrived), null, { timeout: 30000 })
await p.evaluate(() => __shop.aimAt('st', 'dough')); await p.waitForTimeout(300)
await p.screenshot({ path: `tools/shots/tour-${tag}-1dough.png` })
await p.evaluate(() => __shop.use()); await p.waitForTimeout(300)
await p.evaluate(() => __shop.aimAt('st', 'oven1')); await p.waitForTimeout(300)
await p.screenshot({ path: `tools/shots/tour-${tag}-2hold.png` })
await p.evaluate(() => __shop.use()); await p.waitForTimeout(7200)
await p.evaluate(() => { const m = __shop.me(); m.z = -2.9; m.x = -4.6; m.yaw = Math.PI; m.pitch = -0.15 }); await p.waitForTimeout(300)
await p.screenshot({ path: `tools/shots/tour-${tag}-3oven.png` })
await p.evaluate(() => __shop.aimAt('st', 'oven1')); await p.waitForTimeout(200)
await p.evaluate(() => __shop.use()); await p.waitForTimeout(300)
await p.evaluate(() => { const c = __shop.state().customers.find(c => c.st === 'order'); __shop.aimAt('cu', c.id); const m = __shop.me(); m.z = Math.min(m.z, 0.1); m.pitch = 0.02 }); await p.waitForTimeout(400)
await p.screenshot({ path: `tools/shots/tour-${tag}-4counter.png` })
console.log('errors', errs)
await b.close(); await srv.close()
