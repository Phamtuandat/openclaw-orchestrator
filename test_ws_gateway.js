const WebSocket = require('ws');
const token = 'abbd92652f97fa8abf7af39d04dc0525146f38a1500c1882361e6a8bf240a814';
const url = `ws://127.0.0.1:18789?token=${token}`;

console.log('Connecting to', url.replace(token, 'TOKEN'));

const ws = new WebSocket(url, { handshakeTimeout: 5000 });

ws.on('open', () => {
  console.log('Connected! Sending test request...');
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 'test1',
    method: 'tools.invoke',
    args: { tool: 'session_status' }
  }));
});

ws.on('message', (data) => {
  console.log('Received:', data.toString());
});

ws.on('close', (code, reason) => {
  console.log('Closed:', code, reason.toString());
});

ws.on('error', (err) => {
  console.error('Error:', err.message);
});

setTimeout(() => {
  if (ws.readyState === WebSocket.CONNECTING) {
    console.log('Timeout');
    ws.close();
  }
}, 10000);