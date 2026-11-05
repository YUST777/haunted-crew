# Tiny client for the MCP for Blender addon socket (same JSON protocol the MCP server uses).
# Usage: python3 bmcp.py script.py   -> runs the script inside the open Blender, prints the result.
import json
import socket
import sys


def send(cmd_type, params=None, host='127.0.0.1', port=9876):
    s = socket.create_connection((host, port), timeout=600)
    s.sendall(json.dumps({'type': cmd_type, 'params': params or {}}).encode())
    buf = b''
    while True:
        chunk = s.recv(65536)
        if not chunk:
            break
        buf += chunk
        try:
            return json.loads(buf.decode())
        except json.JSONDecodeError:
            continue
    return json.loads(buf.decode())


if __name__ == '__main__':
    if sys.argv[1] == '--type':
        print(json.dumps(send(sys.argv[2], json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}), indent=1)[:4000])
    else:
        code = open(sys.argv[1]).read()
        print(json.dumps(send('execute_code', {'code': code}), indent=1)[:4000])
