import json
import urllib.request
import websocket # pip install websocket-client
import sys

def main():
    try:
        req = urllib.request.Request('http://127.0.0.1:9222/json/list')
        with urllib.request.urlopen(req) as response:
            targets = json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print("Failed to get targets:", e)
        return

    page_target = next((t for t in targets if t['type'] == 'page'), None)
    if not page_target:
        print("No page target found")
        return

    ws_url = page_target['webSocketDebuggerUrl']
    ws = websocket.create_connection(ws_url)
    
    # We need to evaluate chrome.management.getAll()
    # BUT chrome.management is ONLY available to extensions and WebUI pages!
    # Let's navigate to chrome://extensions first
    msg = {
        "id": 1,
        "method": "Page.navigate",
        "params": {"url": "chrome://extensions/"}
    }
    ws.send(json.dumps(msg))
    
    # Wait for navigation
    import time
    time.sleep(1)
    
    # Evaluate
    msg = {
        "id": 2,
        "method": "Runtime.evaluate",
        "params": {
            "expression": "new Promise(resolve => chrome.management.getAll(resolve))",
            "awaitPromise": True,
            "returnByValue": True
        }
    }
    ws.send(json.dumps(msg))
    
    while True:
        resp = json.loads(ws.recv())
        if resp.get('id') == 2:
            print(json.dumps(resp, indent=2))
            break
            
if __name__ == '__main__':
    main()
