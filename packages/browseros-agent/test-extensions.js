const CDP = require('chrome-remote-interface')
async function run() {
  const client = await CDP({ port: 9000 })
  const { Page, Runtime } = client
  await Page.enable()
  await Runtime.enable()
  await Page.navigate({ url: 'chrome://extensions/' })
  await Page.loadEventFired()
  const res = await Runtime.evaluate({
    expression: 'new Promise(resolve => chrome.management.getAll(resolve))',
    awaitPromise: true,
    returnByValue: true,
  })
  console.log(JSON.stringify(res.result.value, null, 2))
  await client.close()
}
run().catch(console.error)
