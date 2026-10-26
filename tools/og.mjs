// og.png（1200x630）を作る: 実際の営業画面を撮って、その上に題名を載せる
import { chromium } from 'playwright'
import { readFile, writeFile } from 'node:fs/promises'
import { startServer } from '../server.mjs'
const srv = await startServer({ port: 0, quiet: true })
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const p = await (await b.newContext({ viewport: { width: 1200, height: 630 }, locale: 'ja-JP' })).newPage()
await p.goto(`http://localhost:${srv.port}/?duration=400`)
await p.waitForFunction(() => window.__boot)
await p.evaluate(() => { const pr = window.__app.prof(); pr.location = 'station' })
await p.click('#soloBtn')
await p.waitForFunction(() => window.__shop && window.__shop.state())
await p.waitForFunction(() => __shop.state().customers.filter(c => c.st === 'order' && c.arrived).length >= 2, null, { timeout: 90000 })
await p.evaluate(() => { const m = __shop.me(); m.x = 2.6; m.z = -0.2; m.yaw = -0.62; m.pitch = -0.08; document.querySelector('#hud').style.display = 'none' })
await p.waitForTimeout(800)
const bg = await p.screenshot()
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;width:1200px;height:630px;position:relative;font-family:"Hiragino Maru Gothic ProN","Hiragino Sans",sans-serif;overflow:hidden}
img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.sh{position:absolute;inset:0;background:linear-gradient(90deg,rgba(28,20,14,.88) 0%,rgba(28,20,14,.6) 42%,rgba(28,20,14,0) 70%)}
.t{position:absolute;left:64px;top:150px;color:#fff}
.e{font-size:28px;font-weight:800;color:#f2b632;letter-spacing:.12em}
h1{margin:10px 0 0;font-size:118px;line-height:1;letter-spacing:.04em}
.bar{width:120px;height:10px;border-radius:5px;margin:22px 0;background:repeating-linear-gradient(90deg,#e0702e 0 20px,#f2b632 20px 40px)}
p{margin:0;font-size:34px;font-weight:800;line-height:1.5}
.n{position:absolute;left:64px;bottom:56px;font-size:26px;font-weight:800;color:#fff;background:#e0702e;padding:8px 20px;border-radius:99px}
</style><img src="data:image/png;base64,${bg.toString('base64')}"><div class="sh"></div>
<div class="t"><div class="e">一人称の協力店舗ゲーム</div><h1>仮の店</h1><div class="bar"></div><p>焼いて、注いで、渡して、会計。<br>ピークは全員で走り回る。</p></div><div class="n">1〜4人・スマホでも遊べる</div>`
await p.setContent(html)
await p.screenshot({ path: 'public/og.png' })
await b.close(); await srv.close()
console.log('og.png', (await readFile('public/og.png')).length)
void writeFile
