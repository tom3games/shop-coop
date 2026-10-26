// 見た目の確認用: ひとりで営業して、麺→茹で釜→丼→スープ→盛る→ネギ→客に向く を撮る。SIZE=844x390 TOUCH=1 BR=webkit で変える
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
await p.screenshot({ path: `tools/shots/tour-${tag}-0title.png` })
await p.click('#soloBtn')
await p.waitForFunction(() => window.__shop && window.__shop.state())
await p.waitForTimeout(600)
await p.screenshot({ path: `tools/shots/tour-${tag}-1start.png` })
const use = async (k, id, shot) => {
  await p.evaluate(([k, id]) => __shop.aimAt(k, id), [k, id]); await p.waitForTimeout(250)
  if (shot) await p.screenshot({ path: `tools/shots/tour-${tag}-${shot}.png` })
  return p.evaluate(() => { const a = __shop.action(); __shop.use(); return a && a.label })
}
const log = []
log.push(await use('st', 'noodles', '2noodles'))
await p.waitForTimeout(250)
log.push(await use('st', 'boiler1'))
await p.waitForTimeout(250)
log.push(await use('st', 'bowls'))
await p.waitForTimeout(250)
log.push(await use('st', 'soup', '3soup'))
await p.waitForTimeout(5200)
await p.evaluate(() => { const m = __shop.me(); m.x = -4.6; m.z = -2.7; m.yaw = Math.PI; m.pitch = -0.35 }); await p.waitForTimeout(400)
await p.screenshot({ path: `tools/shots/tour-${tag}-4boiler.png` })
await p.waitForTimeout(1600)
log.push(await use('st', 'boiler1'))
await p.waitForTimeout(250)
log.push(await use('st', 'negi', '5negi'))
await p.waitForFunction(() => __shop.state().customers.some(c => c.st === 'order' && c.arrived), null, { timeout: 30000 })
await p.evaluate(() => { const c = __shop.state().customers.find(c => c.st === 'order'); __shop.aimAt('cu', c.id); const m = __shop.me(); m.pitch = 0.02 }); await p.waitForTimeout(500)
await p.screenshot({ path: `tools/shots/tour-${tag}-6counter.png` })
log.push(await p.evaluate(() => { const a = __shop.action(); __shop.use(); return a && a.label }))
await p.waitForTimeout(1500)
await p.evaluate(() => { const m = __shop.me(); m.x = 0; m.z = 0.1; m.yaw = Math.PI * 0.85; m.pitch = 0.1 }); await p.waitForTimeout(400)
await p.screenshot({ path: `tools/shots/tour-${tag}-7wide.png` })
await p.evaluate(() => { const m = __shop.me(); m.x = 0; m.z = -0.2; m.yaw = 0; m.pitch = 0.08 }); await p.waitForTimeout(400)
await p.screenshot({ path: `tools/shots/tour-${tag}-8hall.png` })
console.log(log.join(' / '))
console.log('errors', errs)
await b.close(); await srv.close()
