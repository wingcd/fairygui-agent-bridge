import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { message } from './mcp.mjs';
import { viewer } from './viewer.mjs';

const version = '2025-03-26', maxBody = 16 * 1024 * 1024;
export function createServer() {
  return http.createServer((req, res) => {
    const reply = (status, value) => { const body = value === undefined ? '' : JSON.stringify(value); res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store'}); res.end(body); };
    const port = res.socket.localPort;
    const viewerRequest=req.url === '/viewer-rpc';
    if ((!viewerRequest && req.headers.origin) || (viewerRequest && req.headers.origin !== `http://${req.headers.host}`) || ![`localhost:${port}`,`127.0.0.1:${port}`].includes(req.headers.host)) { req.resume(); return reply(403,{error:'loopback host required; browser origins are not accepted'}); }
    if (req.method === 'GET' && req.url === '/viewer') { res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'}); return res.end(viewer); }
    if (req.method === 'GET' && req.url === '/health') return reply(200,{ok:true,transport:'json-rpc-http',mcp_version:version});
    if (req.method !== 'POST' || !['/rpc','/mcp','/viewer-rpc'].includes(req.url)) { req.resume(); return reply(404,{error:'not found'}); }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) { req.resume(); return reply(415,{error:'Content-Type must be application/json'}); }
    if (req.url === '/mcp' && (!req.headers.accept?.includes('application/json') || !req.headers.accept?.includes('text/event-stream'))) { req.resume(); return reply(406,{error:'Accept must include application/json and text/event-stream'}); }
    if (req.url === '/mcp' && req.headers['mcp-protocol-version'] && req.headers['mcp-protocol-version'] !== version) { req.resume(); return reply(400,{error:'unsupported MCP protocol version'}); }
    let size = 0, parts = [], exceeded = false;
    req.on('data', part => { size += part.length; if (size > maxBody) { exceeded = true; parts = []; } else parts.push(part); });
    req.on('end', async () => {
      if (exceeded || !size) return reply(413,{error:'invalid request size'});
      let parsed;
      try { parsed = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts))); }
      catch { return reply(400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}); }
      if (viewerRequest && (Array.isArray(parsed) || parsed?.method !== 'tools/call' || !['screenshot','list_packages','list_items','list_controllers','list_children'].includes(parsed?.params?.name))) return reply(403,{error:'viewer only accepts preview and listing calls'});
      if (Array.isArray(parsed)) {
        if (req.url !== '/mcp' || !parsed.length || parsed.length > 100 || parsed.some(item => item?.method === 'initialize')) return reply(400,{jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid batch'}});
        const responses = (await Promise.all(parsed.map(item => message(item,version)))).filter(Boolean);
        return responses.length ? reply(200,responses) : reply(202);
      }
      const response = await message(parsed,version);
      return response ? reply(200,response) : reply(req.url === '/mcp' ? 202 : 204);
    });
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf('--port'), port = index < 0 ? 7532 : Number(process.argv[index+1]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('port must be between 0 and 65535');
  createServer().listen(port,'127.0.0.1',function() { process.stderr.write(`http://127.0.0.1:${this.address().port}/rpc\n`); });
}
