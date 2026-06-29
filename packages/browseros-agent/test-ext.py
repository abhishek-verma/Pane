import json, urllib.request
try:
    req = urllib.request.Request('http://127.0.0.1:9000/json/list')
    with urllib.request.urlopen(req) as response:
        print(response.read().decode('utf-8'))
except Exception as e:
    print(e)
