const { io } = require('/app/node_modules/socket.io-client');
const token = process.argv[2];
const socket = io('http://localhost:4000', { path: '/socket.io', auth: { token }, transports:['websocket'] });
socket.on('connect', () => { console.log('CONNECTED sid=' + socket.id); });
socket.on('connect_error', (e) => console.log('CONNECT_ERROR ' + e.message));
setTimeout(() => { console.log('done waiting'); process.exit(0); }, 15000);
