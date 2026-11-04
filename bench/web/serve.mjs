// Minimal static server with COOP/COEP (needed for SharedArrayBuffer -> WASM threads). Local only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const MIME = { '.html':'text/html', '.mjs':'text/javascript', '.js':'text/javascript', '.wasm':'application/wasm',
  '.json':'application/json', '.jpg':'image/jpeg', '.png':'image/png', '.task':'application/octet-stream', '.onnx':'application/octet-stream' };
export function serve(root, port = 0) {
  const srv = http.createServer((req, res) => {
    const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream',
      'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-resource-policy': 'same-origin' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}
