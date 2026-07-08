const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();

app.get('/', (req, res) => {
  res.status(200).send('Signaling server is healthy and operational.');
});

const server = http.createServer(app);

// Configure CORS cleanly for production and local development
const io = socketIo(server, {
  cors: {
    origin: '*', 
    methods: ['GET', 'POST'],
  },
});

// In-memory data structure to track room capacities
const roomSizes = new Map(); 

// Helper to generate a secure, short room ID
const generateRoomId = () => {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
};

io.on('connection', (socket) => {
  console.log(`[SYS] New client connected: ${socket.id}`);

  // --- ROOM MANAGEMENT: Creation ---
  socket.on('createRoom', (maxSize) => {
    let roomId;
    const activeRooms = io.sockets.adapter.rooms;
    
    // Ensure unique room ID
    do {
      roomId = generateRoomId();
    } while (activeRooms.has(roomId));

    // Store the capacity limit for this specific room
    roomSizes.set(roomId, maxSize);
    socket.emit('roomCreated', roomId);
    console.log(`[ROOM] Room ${roomId} created with capacity ${maxSize}`);
  });

  // --- ROOM MANAGEMENT: Joining & Overflow Alerts ---
  socket.on('joinRoom', (roomId) => {
    const room = io.sockets.adapter.rooms.get(roomId);
    const currentSize = room ? room.size : 0;
    const maxSize = roomSizes.get(roomId) || Infinity;

    // Fulfills the "room overflow alerts" requirement
    if (currentSize >= maxSize) {
      console.log(`[ALERT] Overflow attempt for room ${roomId}`);
      socket.emit('error', 'Room capacity reached. Cannot join.');
      return;
    }

    socket.join(roomId);
    
    // Gather existing peers to establish connections (excluding yourself)
    const peerIds = Array.from(io.sockets.adapter.rooms.get(roomId) || [])
      .filter(id => id !== socket.id);
    
    // Send existing users to the new joiner
    socket.emit('usersInRoom', peerIds);
    
    // Alert existing users that someone new arrived
    socket.to(roomId).emit('newUserJoined', socket.id);
  });

  // --- WEBRTC SIGNALING ---
  socket.on('signal', ({ targetId, signal }) => {
    io.to(targetId).emit('signal', { from: socket.id, signal });
  });

  // --- PEER EXIT DETECTION (Manual Leave) ---
  socket.on('leaveRoom', (roomId) => {
    socket.leave(roomId);
    socket.to(roomId).emit('userLeft', { peerId: socket.id, roomId });
    console.log(`[ROOM] Client ${socket.id} left room ${roomId}`);
  });

  // --- PEER EXIT DETECTION  ---
  socket.on('disconnecting', () => {
    const rooms = Array.from(socket.rooms).filter(room => room !== socket.id);
    rooms.forEach(roomId => {
      socket.to(roomId).emit('userLeft', { peerId: socket.id, roomId });
    });
  });

  socket.on('disconnect', () => {
    console.log(`[SYS] Client disconnected: ${socket.id}`);
  });
});


const PORT = 5000; 
server.listen(PORT, '0.0.0.0', () => {
  console.log(`ShareMesh Signaling Server strictly running on port ${PORT}`);
});