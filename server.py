"""开发服务器：禁止缓存，便于原型迭代"""
import http.server
import socketserver

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Expires', '0')
        super().end_headers()

if __name__ == '__main__':
    port = 8765
    with socketserver.TCPServer(('127.0.0.1', port), NoCacheHandler) as httpd:
        print(f'serving at http://127.0.0.1:{port}')
        httpd.serve_forever()
