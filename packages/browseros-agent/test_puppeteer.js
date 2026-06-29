const puppeteer = require('puppeteer-core')
;(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9000',
  })
  const targets = await browser.targets()
  for (const t of targets) {
    if (
      t.type() === 'page' ||
      t.type() === 'service_worker' ||
      t.type() === 'background_page'
    ) {
      console.log('Target:', t.url())
      if (t.url().includes('chrome-extension://')) {
        const page = await t.page()
        if (page) {
          page.on('console', (msg) => console.log('PAGE LOG:', msg.text()))
          page.on('pageerror', (err) => console.log('PAGE ERROR:', err))
        }
      }
    }
  }
  // Wait a bit to collect logs
  await new Promise((r) => setTimeout(r, 5000))
  await browser.disconnect()
  process.exit(0)
})()
