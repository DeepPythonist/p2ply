#!/usr/bin/env python3
import os
import sys
import subprocess
import signal
import time
import socket
import re
import tempfile

PROJ_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_FILE = os.path.join(PROJ_DIR, 'server.js')
NODE_PORT = 0

p_node = None
p_tunnel = None
temp_key_path = None

def get_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]

def cleanup(sig, frame):
    print("\n[!] Shutting down...")
    if p_node:
        p_node.terminate()
    if p_tunnel:
        p_tunnel.terminate()
    
    if temp_key_path and os.path.exists(temp_key_path):
        try:
            os.remove(temp_key_path)
            os.remove(temp_key_path + ".pub")
        except:
            pass
    sys.exit(0)

def main():
    global p_node, p_tunnel, temp_key_path
    
    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    print("--- P2Ply Secure Launcher (Remote Only) ---")
    
    if not os.path.exists(os.path.join(PROJ_DIR, 'node_modules')):
        print("[*] Installing dependencies...")
        subprocess.check_call(['npm', 'install'], cwd=PROJ_DIR)

    remote_mode = True
    
    env = os.environ.copy()
    port = get_free_port()
    env['PORT'] = str(port)
    
    print(f"[*] Starting local server on port {port}...")
    p_node = subprocess.Popen(['node', SERVER_FILE], cwd=PROJ_DIR, env=env)
    
    time.sleep(1)
    if p_node.poll() is not None:
        print("[!] Node server failed to start.")
        sys.exit(1)

    print(f"\n[+] Local Access: http://localhost:{port}")
    
    if remote_mode:
        print("[*] establishing secure tunnel...")
        
        with tempfile.NamedTemporaryFile(delete=True, prefix='p2ply_key_') as tmp:
            temp_key_path = tmp.name
        
        subprocess.check_call(['ssh-keygen', '-t', 'ed25519', '-f', temp_key_path, '-N', '', '-q'])
        
        cmd = [
            'ssh', '-R', f'80:localhost:{port}', 
            '-i', temp_key_path,
            '-o', 'StrictHostKeyChecking=no', 
            '-o', 'UserKnownHostsFile=/dev/null',
            'nokey@localhost.run'
        ]
        
        p_tunnel = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        
        print("[*] Waiting for tunnel URL... (SSH output will appear below)")
        try:
            while True:
                line = p_tunnel.stdout.readline()
                if not line: break
                
                match = re.search(r'(https://[a-zA-Z0-9-]+\.(localhost\.run|lhr\.life))', line)
                if match:
                    url = match.group(1)
                    if 'admin.localhost.run' not in url and 'localhost.run/docs' not in url:
                        print(f"\n\n[+] REMOTE ACCESS URL: {url}")
                        print("[!] Share this URL ONLY with trusted peers.")
                        
                        try:
                            import urllib.request
                            import json
                            req = urllib.request.Request(
                                f"http://localhost:{port}/set-remote-url",
                                data=json.dumps({"url": url}).encode('utf-8'),
                                headers={'Content-Type': 'application/json'}
                            )
                            urllib.request.urlopen(req)
                        except Exception as e:
                            print(f"[!] Failed to sync URL with server: {e}")
                            
                        break
        except Exception as e:
            print(f"[!] Tunnel error: {e}")

    print("\n[*] System active. Press Ctrl+C to stop.")
    signal.pause()

if __name__ == '__main__':
    main()
