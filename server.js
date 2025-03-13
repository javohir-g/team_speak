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
const fs = require('fs').promises;

// Путь к файлу статистики
const STATS_FILE = path.join(__dirname, 'stats.json');

// Статические файлы
app.use(express.static('public'));

// Хранение информации о комнатах и пользователях
const rooms = {
    'Chat 1': { users: new Map(), totalVisits: 0, maxUsers: 20 },
    'Chat 2': { users: new Map(), totalVisits: 0, maxUsers: 10 }
};

// Защищенные комнаты (не удаляются автоматически)
const protectedRooms = new Map();

// Общая статистика
const stats = {
    totalConnections: 0,
    peakConcurrentUsers: 0,
    currentConcurrentUsers: 0
};

// Загрузка статистики при запуске
async function loadStats() {
    try {
        const data = await fs.readFile(STATS_FILE, 'utf8');
        const savedStats = JSON.parse(data);
        
        // Восстанавливаем общую статистику
        stats.totalConnections = savedStats.totalConnections || 0;
        stats.peakConcurrentUsers = savedStats.peakConcurrentUsers || 0;
        
        // Восстанавливаем статистику комнат
        for (const [roomName, roomData] of Object.entries(savedStats.rooms || {})) {
            if (rooms[roomName]) {
                rooms[roomName].totalVisits = roomData.totalVisits || 0;
            }
        }
        
        console.log('Статистика успешно загружена');
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Ошибка при загрузке статистики:', error);
        }
    }
}

// Сохранение статистики
async function saveStats() {
    try {
        const dataToSave = {
            totalConnections: stats.totalConnections,
            peakConcurrentUsers: stats.peakConcurrentUsers,
            currentConcurrentUsers: stats.currentConcurrentUsers,
            rooms: {}
        };

        // Сохраняем статистику комнат
        for (const [roomName, room] of Object.entries(rooms)) {
            dataToSave.rooms[roomName] = {
                totalVisits: room.totalVisits
            };
        }

        await fs.writeFile(STATS_FILE, JSON.stringify(dataToSave, null, 2));
    } catch (error) {
        console.error('Ошибка при сохранении статистики:', error);
    }
}

// Загружаем статистику при запуске сервера
loadStats();

// Сохраняем статистику каждую минуту
setInterval(saveStats, 60000);

// Сохраняем статистику при завершении работы сервера
process.on('SIGINT', async () => {
    console.log('Сохранение статистики перед выключением...');
    await saveStats();
    process.exit();
});

process.on('SIGTERM', async () => {
    console.log('Сохранение статистики перед выключением...');
    await saveStats();
    process.exit();
});

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

// API для создания комнаты
app.post('/api/rooms', express.json(), (req, res) => {
    const { name, password, maxUsers } = req.body;

    if (!name || !password) {
        return res.status(400).json({ error: 'Необходимо указать название и пароль' });
    }

    if (rooms[name] || protectedRooms.has(name)) {
        return res.status(400).json({ error: 'Комната с таким названием уже существует' });
    }

    rooms[name] = { 
        users: new Map(), 
        totalVisits: 0, 
        maxUsers: maxUsers || 10 
    };
    protectedRooms.set(name, { 
        password,
        maxUsers: maxUsers || 10
    });

    // Оповещаем всех о новой комнате
    io.emit('room-created', { name, isProtected: true });

    res.json({ success: true });
});

// API для проверки пароля комнаты
app.post('/api/rooms/verify', express.json(), (req, res) => {
    const { name, password } = req.body;
    const room = protectedRooms.get(name);

    if (!room) {
        return res.status(404).json({ error: 'Комната не найдена' });
    }

    if (room.password !== password) {
        return res.status(403).json({ error: 'Неверный пароль' });
    }

    res.json({ success: true });
});

// API для получения списка комнат
app.get('/api/rooms', (req, res) => {
    const publicRooms = Object.keys(rooms).map(name => ({
        name,
        isProtected: protectedRooms.has(name),
        userCount: rooms[name].users.size,
        maxUsers: rooms[name].maxUsers || 10
    }));

    res.json(publicRooms);
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

    socket.on('join-room', async ({ room, username, password }) => {
        console.log(`Пользователь ${username} (${socket.id}) присоединяется к комнате ${room}`);
        
        if (!rooms[room]) {
            socket.emit('error', 'Комната не существует');
            return;
        }

        // Проверяем пароль только для защищенных комнат (не Chat 1 и Chat 2)
        if (protectedRooms.has(room) && room !== 'Chat 1' && room !== 'Chat 2') {
            const protectedRoom = protectedRooms.get(room);
            if (protectedRoom.password !== password) {
                socket.emit('error', 'Неверный пароль');
                return;
            }
        }

        // Проверяем количество пользователей
        if (rooms[room].users.size >= (rooms[room].maxUsers || 10)) {
            socket.emit('error', 'Комната заполнена');
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

    // Обработка управления музыкой
    socket.on('music-control', (data) => {
        const { room, action, trackId } = data;
        if (rooms[room]) {
            // Отправляем сигнал всем пользователям в комнате, кроме отправителя
            rooms[room].users.forEach((user, userId) => {
                if (userId !== socket.id) {
                    io.to(userId).emit('music-control', {
                        action,
                        trackId,
                        userId: socket.id
                    });
                }
            });
        }
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

        // Если комната пуста и не является защищенной, удаляем её
        if (rooms[room].users.size === 0 && !protectedRooms.has(room)) {
            console.log(`Удаление пустой комнаты: ${room}`);
            delete rooms[room];
            protectedRooms.delete(room);
            // Оповещаем всех об удалении комнаты
            io.emit('room-deleted', { name: room });
        }
    }
}

// Очистка пустых комнат (каждые 5 минут) - резервный механизм
setInterval(() => {
    for (const [roomName, room] of Object.entries(rooms)) {
        if (room.users.size === 0 && !protectedRooms.has(roomName)) {
            console.log(`Резервная очистка пустой комнаты: ${roomName}`);
            delete rooms[roomName];
            protectedRooms.delete(roomName);
            // Оповещаем всех об удалении комнаты
            io.emit('room-deleted', { name: roomName });
        }
    }
}, 5 * 60 * 1000); // Проверка каждые 5 минут

// Запуск сервера
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
}); 