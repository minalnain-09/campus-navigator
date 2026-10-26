# Local server for development: like `python3 -m http.server 8000`, but tells the
# browser never to cache, so a normal refresh always loads the latest files.
# Run:  python3 serve.py   then open http://localhost:8000
import http.server
import socketserver

PORT = 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), NoCacheHandler) as httpd:
    print(f"Serving on http://localhost:{PORT} (no caching)")
    httpd.serve_forever()
