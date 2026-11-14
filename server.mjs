import { WebSocketServer } from 'ws';

const server = new WebSocketServer({ port: 8787 });

server.on('connection', (socket) => {
  socket.on('message', (data) => {
    const { topic } = JSON.parse(String(data));
    socket.send(JSON.stringify({ topic: 'ack', payload: { of: topic } }));
  });
});
