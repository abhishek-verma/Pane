const http = require('node:http')

http.get('http://127.0.0.1:9222/json/list', (res) => {
  let data = ''
  res.on('data', (chunk) => (data += chunk))
  res.on('end', () => {
    const targets = JSON.parse(data)
    const page = targets.find((t) => t.type === 'page')
    if (!page) {
      console.log('No page target')
      return
    }

    // We can just use standard node ws or puppeteer, wait puppeteer is not installed globally.
    console.log(page.webSocketDebuggerUrl)
  })
})
