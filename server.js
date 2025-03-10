const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000
});
const path = require('path');

// Статические файлы
app.use(express.static('public'));

// Хранение информации о комнатах и пользователях
const rooms = {
    'Комната 1': { users: new Map(), totalVisits: 0 },
    'Комната 2': { users: new Map(), totalVisits: 0 },
    'Комната 3': { users: new Map(), totalVisits: 0 },
    'Комната 4': { users: new Map(), totalVisits: 0 },
    'Комната 5': { users: new Map(), totalVisits: 0 }
};

// Общая статистика
const stats = {
    totalConnections: 0,
    peakConcurrentUsers: 0,
    currentConcurrentUsers: 0
};

// Админ-маршрут для статистики
app.get('/admin-stats', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// API для получения статистики
app.get('/api/stats', (req, res) => {
    const roomStats = {};
    for (const [roomName, room] of Object.entries(rooms)) {
        roomStats[roomName] = {
            userCount: room.users.size,
            totalVisits: room.totalVisits,
            users: Array.from(room.users.values()).map(u => ({
                id: u.id,
                username: u.username,
                muted: u.muted,
                joinTime: u.joinTime
            }))
        };
    }
    
    res.json({
        rooms: roomStats,
        globalStats: stats
    });
});

// Обработка Socket.IO соединений
io.on('connection', (socket) => {
    console.log('Новое подключение:', socket.id);
    stats.totalConnections++;
    stats.currentConcurrentUsers++;
    stats.peakConcurrentUsers = Math.max(stats.peakConcurrentUsers, stats.currentConcurrentUsers);

    let currentRoom = null;
    let userData = null;

    // Отправляем подтверждение подключения
    socket.emit('connection-established', { id: socket.id });

    socket.on('join-room', ({ room, username }) => {
        console.log(`Пользователь ${username} (${socket.id}) присоединяется к комнате ${room}`);
        
        if (!rooms[room]) {
            socket.emit('error', 'Комната не существует');
            return;
        }

        // Покидаем текущую комнату, если есть
        if (currentRoom) {
            leaveRoom(socket, currentRoom);
        }

        // Присоединяемся к новой комнате
        currentRoom = room;
        userData = { 
            id: socket.id, 
            username, 
            muted: false,
            joinTime: new Date().toISOString()
        };
        
        socket.join(room);
        rooms[room].users.set(socket.id, userData);
        rooms[room].totalVisits++;

        // Оповещаем всех в комнате о новом пользователе
        socket.to(room).emit('user-connected', { userId: socket.id, username });

        // Отправляем список пользователей
        const roomUsers = Array.from(rooms[room].users.values());
        io.to(room).emit('room-users', roomUsers);
        
        console.log(`Пользователь ${username} (${socket.id}) присоединился к комнате ${room}`);
        console.log('Пользователи в комнате:', roomUsers);
    });

    socket.on('signal', ({ userId, signal }) => {
        if (!userId) {
            console.log('Получен сигнал с пустым userId');
            return;
        }

        console.log(`Передача сигнала от ${socket.id} к ${userId}, тип: ${signal.type}`);
        
        // Проверяем, существует ли целевой пользователь
        let targetRoom = null;
        for (const [roomName, room] of Object.entries(rooms)) {
            if (room.users.has(userId)) {
                targetRoom = roomName;
                break;
            }
        }

        if (!targetRoom) {
            console.log(`Ошибка: пользователь ${userId} не найден в комнатах`);
            return;
        }

        // Отправляем сигнал целевому пользователю
        io.to(userId).emit('signal', {
            userId: socket.id,
            signal: signal
        });
    });

    socket.on('user-mute-change', ({ room, muted }) => {
        if (currentRoom && rooms[room] && rooms[room].users.has(socket.id)) {
            console.log(`Пользователь ${socket.id} ${muted ? 'выключил' : 'включил'} микрофон`);
            const user = rooms[room].users.get(socket.id);
            user.muted = muted;
            rooms[room].users.set(socket.id, user);
            io.to(room).emit('room-users', Array.from(rooms[room].users.values()));
        }
    });

    socket.on('leave-room', ({ room }) => {
        console.log(`Пользователь ${userData?.username} (${socket.id}) покидает комнату ${room}`);
        if (currentRoom) {
            leaveRoom(socket, currentRoom);
            currentRoom = null;
            userData = null;
        }
    });

    socket.on('disconnect', () => {
        stats.currentConcurrentUsers--;
        console.log(`Пользователь отключился: ${socket.id}`);
        if (currentRoom) {
            leaveRoom(socket, currentRoom);
        }
    });

    // Добавляем обработку ошибок
    socket.on('error', (error) => {
        console.error(`Ошибка сокета для пользователя ${socket.id}:`, error);
    });
});

// Функция для покидания комнаты
function leaveRoom(socket, room) {
    if (rooms[room] && rooms[room].users.has(socket.id)) {
        const userData = rooms[room].users.get(socket.id);
        rooms[room].users.delete(socket.id);
        socket.leave(room);
        
        // Оповещаем остальных пользователей
        io.to(room).emit('user-disconnected', { userId: socket.id, username: userData.username });
        io.to(room).emit('room-users', Array.from(rooms[room].users.values()));
        
        console.log(`Пользователь ${userData.username} (${socket.id}) покинул комнату ${room}`);
        console.log('Оставшиеся пользователи:', Array.from(rooms[room].users.values()));
    }
}

// Очистка пустых комнат (каждые 5 минут)
setInterval(() => {
    for (const [roomName, room] of Object.entries(rooms)) {
        if (room.users.size === 0) {
            console.log(`Очистка пустой комнаты: ${roomName}`);
            room.users.clear();
        }
    }
}, 5 * 60 * 1000);

// Запуск сервера
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
}); 