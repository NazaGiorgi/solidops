const { io } = require('socket.io-client');
const fs = require('fs');
const token = process.argv[2];
const log = (m) => fs.appendFileSync('/tmp/ws.log', m + '\n');
const socket = io('http://backend:4000', { path: '/socket.io', auth: { token }, transports: ['websocket'] });
socket.on('connect', () => log('SOCKET CONNECTED ' + socket.id));
socket.on('connect_error', (e) => log('CONNECT_ERROR ' + e.message));
socket.on('notification:new', (n) => log('GOT notification:new ' + JSON.stringify(n)));
setTimeout(() => process.exit(0), 18000);
