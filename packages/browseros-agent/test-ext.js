const puppeteer = require('puppeteer-core')
;(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9000',
  })
  const page = await browser.newPage()
  await page.goto('chrome://extensions')
  const exts = await page.evaluate(() => {
    return new Promise((resolve) => {
      chrome.management.getAll(resolve)
    })
  })
  console.log(JSON.stringify(exts, null, 2))
  process.exit(0)
})()
