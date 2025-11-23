const socket = io();
let localStream;
let peers = {};
let currentRoom = null;
let username = '';
let isMuted = false;
let audioContext;
let analyser;
let microphone;
let isConnecting = false;
let mySocketId = null;
let selectedRoom = null;
let canHearSelf = false;
let currentMusic = null;

// Добавляем звуки
const connectSound = new Audio('/sounds/connect.mp3');
const disconnectSound = new Audio('/sounds/disconnect.mp3');

// Добавляем музыку
const musicTracks = {
    'track1': new Audio('/sounds/music1.mp3'),
    'track2': new Audio('/sounds/music2.mp3'),
    'track3': new Audio('/sounds/music3.mp3'),
    'track4': new Audio('/sounds/music4.mp3'),
    'track5': new Audio('/sounds/music5.mp3')
};

// Обновляем конфигурацию ICE серверов
const ICE_SERVERS = {
    iceServers: [
        {
            urls: [
                'stun:stun.l.google.com:19302',
                'stun:stun1.l.google.com:19302'
            ]
        },
        {
            urls: "turn:a.relay.metered.ca:443",
            username: "33c28cee521d3e69d7466bb6",
            credential: "QLKwIoXFCTXS5Hhx"
        },
        {
            urls: "turn:a.relay.metered.ca:80",
            username: "33c28cee521d3e69d7466bb6",
            credential: "QLKwIoXFCTXS5Hhx"
        }
    ],
    iceCandidatePoolSize: 10
};

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    const usernameInput = document.getElementById('username');
    const roomButtons = document.querySelectorAll('.room-btn');

    // Проверяем поддержку WebRTC
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Ваш браузер не поддерживает WebRTC. Пожалуйста, используйте современный браузер.');
        return;
    }

    // Создаем аудио контекст при взаимодействии с пользователем
    document.body.addEventListener('click', () => {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
    }, { once: true });

    // Обработка входа в комнату
    roomButtons.forEach(button => {
        button.addEventListener('click', async () => {
            username = usernameInput.value.trim();
            if (!username) {
                alert('Пожалуйста, введите ваше имя');
                return;
            }

            try {
                console.log('Запрашиваем доступ к микрофону...');
                // Запрашиваем доступ к микрофону при входе в комнату
                localStream = await navigator.mediaDevices.getUserMedia({ 
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false
                    }
                });
                
                console.log('Доступ к микрофону получен');
                
                // Включаем звук по умолчанию
                localStream.getAudioTracks().forEach(track => {
                    console.log('Состояние аудио трека:', track.enabled, track.readyState);
                    track.enabled = !isMuted;
                });
                
                // Инициализация аудио анализатора
                setupAudioAnalyser(localStream);
                
                const roomName = button.dataset.room;
                joinRoom(roomName);
            } catch (error) {
                console.error('Ошибка доступа к микрофону:', error);
                alert('Не удалось получить доступ к микрофону: ' + error.message);
            }
        });
    });

    updateRoomsList();
    
    // Закрытие модальных окон при клике вне их области
    window.onclick = (event) => {
        const createRoomModal = document.getElementById('createRoomModal');
        const passwordModal = document.getElementById('passwordModal');
        if (event.target === createRoomModal) {
            hideCreateRoomModal();
        }
        if (event.target === passwordModal) {
            hidePasswordModal();
        }
    };
});

// Настройка аудио анализатора
function setupAudioAnalyser(stream) {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    analyser = audioContext.createAnalyser();
    microphone = audioContext.createMediaStreamSource(stream);
    
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    microphone.connect(analyser);
    
    visualize();
}

// Визуализация уровня громкости
function visualize() {
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    function draw() {
        requestAnimationFrame(draw);
        
        if (!isMuted && !document.hidden) {
            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            const volume = Math.min(100, Math.round((average / 256) * 100));
            
            // Обновляем индикатор в кнопке микрофона
            const volumeMeters = document.querySelectorAll('.volume-meter');
            volumeMeters.forEach(meter => {
                meter.style.width = `${volume}%`;
                if (volume < 30) {
                    meter.style.backgroundColor = '#4CAF50';
                } else if (volume < 70) {
                    meter.style.backgroundColor = '#FFC107';
                } else {
                    meter.style.backgroundColor = '#F44336';
                }
            });
            
            // Обновляем индикатор в списке пользователей
            const userVolumeMeter = document.querySelector(`.user-volume-meter[data-user-id="${socket.id}"]`);
            if (userVolumeMeter) {
                userVolumeMeter.style.width = `${volume}%`;
                if (volume < 30) {
                    userVolumeMeter.style.backgroundColor = '#4CAF50';
                } else if (volume < 70) {
                    userVolumeMeter.style.backgroundColor = '#FFC107';
                } else {
                    userVolumeMeter.style.backgroundColor = '#F44336';
                }
            }
        }
    }
    
    draw();
}

// Функции для модальных окон
function showCreateRoomModal() {
    document.getElementById('createRoomModal').style.display = 'block';
}

function hideCreateRoomModal() {
    document.getElementById('createRoomModal').style.display = 'none';
}

function showPasswordModal() {
    document.getElementById('passwordModal').style.display = 'block';
}

function hidePasswordModal() {
    document.getElementById('passwordModal').style.display = 'none';
}

// Создание новой комнаты
async function createRoom() {
    const name = document.getElementById('roomName').value.trim();
    const password = document.getElementById('roomPassword').value;
    const maxUsers = parseInt(document.getElementById('maxUsers').value);

    if (!name || !password) {
        alert('Пожалуйста, заполните все поля');
        return;
    }

    try {
        const response = await fetch('/api/rooms', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, password, maxUsers })
        });

        const data = await response.json();
        if (data.error) {
            alert(data.error);
            return;
        }

        hideCreateRoomModal();
        // Автоматически входим в созданную комнату
        selectedRoom = name;
        joinRoom(name, password);
    } catch (error) {
        console.error('Ошибка при создании комнаты:', error);
        alert('Не удалось создать комнату');
    }
}

// Обновление списка комнат
async function updateRoomsList() {
    try {
        const response = await fetch('/api/rooms');
        const rooms = await response.json();

        const roomsContainer = document.querySelector('.rooms');
        roomsContainer.innerHTML = rooms.map(room => `
            <button class="room-btn" 
                    data-room="${room.name}" 
                    data-protected="${room.isProtected}"
                    onclick="selectRoom('${room.name}', ${room.isProtected})">
                ${room.name}
                <span class="room-info">
                    ${room.userCount}/${room.maxUsers}
                </span>
            </button>
        `).join('');
    } catch (error) {
        console.error('Ошибка при получении списка комнат:', error);
    }
}

// Выбор комнаты
function selectRoom(roomName, isProtected) {
    const username = document.getElementById('username').value.trim();
    if (!username) {
        alert('Пожалуйста, введите ваше имя');
        return;
    }

    selectedRoom = roomName;

    if (isProtected) {
        showPasswordModal();
    } else {
        joinRoom(roomName);
    }
}

// Присоединение к защищенной комнате
async function joinProtectedRoom() {
    const password = document.getElementById('enterPassword').value;
    
    try {
        const response = await fetch('/api/rooms/verify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                name: selectedRoom, 
                password 
            })
        });

        const data = await response.json();
        if (data.error) {
            alert(data.error);
            return;
        }

        hidePasswordModal();
        joinRoom(selectedRoom, password);
    } catch (error) {
        console.error('Ошибка при входе в комнату:', error);
        alert('Не удалось войти в комнату');
    }
}

// Обновляем функцию присоединения к комнате
async function joinRoom(roomName, password = null) {
    const username = document.getElementById('username').value.trim();
    
    if (!username) {
        alert('Пожалуйста, введите ваше имя');
        return;
    }

    try {
        if (!localStream) {
            console.log('Запрашиваем доступ к микрофону...');
            localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });
            console.log('Доступ к микрофону получен');
            setupAudioAnalyser(localStream);
        }

        // Показываем индикатор загрузки
        const roomsContainer = document.querySelector('.rooms');
        roomsContainer.style.opacity = '0.5';
        
        socket.emit('join-room', { 
            room: roomName, 
            username,
            password
        });

    } catch (error) {
        console.error('Ошибка при входе в комнату:', error);
        alert('Не удалось получить доступ к микрофону. Пожалуйста, проверьте настройки браузера.');
        const roomsContainer = document.querySelector('.rooms');
        roomsContainer.style.opacity = '1';
    }
}

// Обработчик создания новой комнаты
socket.on('room-created', ({ name, isProtected }) => {
    updateRoomsList();
});

// Обработчик удаления комнаты
socket.on('room-deleted', ({ name }) => {
    console.log(`Комната ${name} была удалена`);
    updateRoomsList();
});

// Обновляем обработчик user-connected
socket.on('user-connected', ({ userId, username }) => {
    console.log(`Пользователь ${username} присоединился (ID: ${userId})`);
    if (userId && userId !== mySocketId) {
        connectToNewUser(userId, username);
        playSound(connectSound);
    }
});

// Обновляем обработчик user-disconnected
socket.on('user-disconnected', ({ userId, username }) => {
    console.log(`Пользователь ${username} отключился (ID: ${userId})`);
    if (peers[userId]) {
        peers[userId].destroy();
        delete peers[userId];
        
        const audioElement = document.getElementById(`audio-${userId}`);
        if (audioElement) {
            audioElement.remove();
        }
    }
    playSound(disconnectSound);
    updateUsersList();
});

socket.on('room-users', (users) => {
    const roomsContainer = document.querySelector('.rooms');
    roomsContainer.style.opacity = '1';
    
    // Скрываем контейнер с выбором комнаты
    const container = document.querySelector('.container');
    if (container) {
        container.style.display = 'none';
    }
    
    // Показываем интерфейс комнаты
    const roomInterface = document.querySelector('.room');
    if (roomInterface) {
        roomInterface.style.display = 'flex';
        const roomNameElement = document.getElementById('room-name');
        if (roomNameElement) {
            roomNameElement.textContent = selectedRoom;
        }
    }
    
    // Устанавливаем текущую комнату
    currentRoom = selectedRoom;
    
    // Обновляем список пользователей
    updateUsersList(users);
    
    // Обновляем список комнат для отображения актуального количества участников
    updateRoomsList();
});

// Обновление списка пользователей
function updateUsersList(users = []) {
    const usersList = document.querySelector('.users-list');
    if (!usersList) return;

    usersList.innerHTML = users.map(user => `
        <div class="user-item${user.id === socket.id ? ' current-user' : ''}">
            <div class="user-info">
                <i class="fas fa-microphone${user.muted ? '-slash' : ''}" style="margin-right: 8px;"></i>
                <span>${user.username}</span>
                <div class="user-volume-container">
                    <div class="user-volume-meter" data-user-id="${user.id}"></div>
                </div>
                ${user.id !== socket.id ? `
                    <div class="volume-slider-container">
                        <input type="range" class="volume-slider" data-user-id="${user.id}" 
                               min="0" max="100" value="${getUserVolume(user.id)}" 
                               title="Громкость пользователя">
                    </div>
                ` : ''}
            </div>
        </div>
    `).join('');

    // Добавляем обработчики для регуляторов громкости
    const volumeSliders = usersList.querySelectorAll('.volume-slider');
    volumeSliders.forEach(slider => {
        slider.addEventListener('input', (e) => {
            const userId = e.target.dataset.userId;
            const volume = e.target.value / 100;
            setUserVolume(userId, volume);
        });
    });
}

// Функция для получения сохраненной громкости пользователя
function getUserVolume(userId) {
    return (localStorage.getItem(`volume-${userId}`) || 100);
}

// Функция для установки громкости пользователя
function setUserVolume(userId, volume) {
    const audioElement = document.getElementById(`audio-${userId}`);
    if (audioElement) {
        audioElement.volume = volume;
    }
    localStorage.setItem(`volume-${userId}`, volume * 100);
}

// Обновляем функцию для обработки аудио потока
function handleAudioStream(stream, userId) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    function updateVolume() {
        if (!document.hidden) {
            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            const volume = Math.min(100, Math.round((average / 256) * 100));
            
            const volumeMeter = document.querySelector(`.user-volume-meter[data-user-id="${userId}"]`);
            if (volumeMeter) {
                volumeMeter.style.width = `${volume}%`;
                if (volume < 30) {
                    volumeMeter.style.backgroundColor = '#4CAF50';
                } else if (volume < 70) {
                    volumeMeter.style.backgroundColor = '#FFC107';
                } else {
                    volumeMeter.style.backgroundColor = '#F44336';
                }
            }
        }
        requestAnimationFrame(updateVolume);
    }
    
    updateVolume();
}

// Обновляем функцию подключения нового пользователя (убираем audioEnabled)
function connectToNewUser(userId, username) {
    if (!userId || userId === mySocketId) {
        console.log('Некорректный ID пользователя:', userId);
        return;
    }

    if (isConnecting) {
        console.log('Уже идет процесс подключения, пропускаем...');
        return;
    }
    
    console.log('Начинаем подключение к пользователю:', username, 'ID:', userId);
    console.log('Мой ID:', mySocketId);
    isConnecting = true;
    
    try {
        const peer = new SimplePeer({
            initiator: true,
            stream: localStream,
            config: ICE_SERVERS,
            trickle: true,
            debug: true,
            reconnectTimer: 1000,
            iceTransportPolicy: 'relay'
        });

        let connectionTimeout = setTimeout(() => {
            console.log('Таймаут соединения, пробуем переподключиться');
            isConnecting = false;
            if (peers[userId]) {
                peers[userId].destroy();
                delete peers[userId];
                setTimeout(() => connectToNewUser(userId, username), 1000);
            }
        }, 15000);

        peer.on('signal', data => {
            console.log('Генерация сигнала для:', username, '(ID:', userId, '), тип:', data.type);
            socket.emit('signal', {
                userId: userId,
                signal: data
            });
        });

        peer.on('connect', () => {
            console.log('Установлено peer-соединение с:', username);
            clearTimeout(connectionTimeout);
            isConnecting = false;
            
            // Отправляем тестовые данные
            try {
                peer.send('test-connection');
            } catch (e) {
                console.error('Ошибка отправки тестовых данных:', e);
            }
        });

        peer.on('data', data => {
            console.log('Получены данные от пира:', data.toString());
        });

        peer.on('stream', stream => {
            console.log('Получен аудио поток от:', username);
            try {
                const audio = createAudioElement(userId, stream);
                document.body.appendChild(audio);
                handleAudioStream(stream, userId);
            } catch (e) {
                console.error('Ошибка при создании аудио элемента:', e);
            }
        });

        // Обновленные обработчики состояния
        peer._pc.onconnectionstatechange = () => {
            const state = peer._pc.connectionState;
            console.log('Состояние соединения изменилось:', state);
            
            if (state === 'connected') {
                console.log('Соединение успешно установлено');
                clearTimeout(connectionTimeout);
                isConnecting = false;
            } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
                console.log('Соединение потеряно, пробуем переподключиться');
                isConnecting = false;
                if (peers[userId]) {
                    peers[userId].destroy();
                    delete peers[userId];
                    setTimeout(() => connectToNewUser(userId, username), 1000);
                }
            }
        };

        peer._pc.oniceconnectionstatechange = () => {
            const state = peer._pc.iceConnectionState;
            console.log('ICE состояние изменилось:', state);
            
            if (state === 'checking') {
                console.log('Проверка ICE кандидатов...');
            } else if (state === 'connected') {
                console.log('ICE соединение установлено');
            } else if (state === 'failed') {
                console.log('ICE соединение не удалось, пробуем TURN');
                isConnecting = false;
                if (peers[userId]) {
                    peers[userId].destroy();
                    delete peers[userId];
                    setTimeout(() => connectToNewUser(userId, username), 1000);
                }
            }
        };

        peer._pc.onicegatheringstatechange = () => {
            console.log('ICE gathering state:', peer._pc.iceGatheringState);
        };

        peer._pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('Новый ICE кандидат:', {
                    type: event.candidate.type,
                    protocol: event.candidate.protocol,
                    address: event.candidate.address
                });
            }
        };

        peers[userId] = peer;
    } catch (error) {
        console.error('Ошибка при создании peer-соединения:', error);
        isConnecting = false;
    }
}

// Обновляем обработчик сигналов
socket.on('signal', async ({ userId, signal }) => {
    if (!userId || userId === mySocketId) {
        console.log('Получен некорректный сигнал:', { userId, type: signal.type });
        return;
    }

    console.log('Получен сигнал от пользователя:', userId, 'тип:', signal.type);
    
    try {
        if (!peers[userId]) {
            console.log('Создаем нового пира для ответа пользователю:', userId);
            const peer = new SimplePeer({
                initiator: false,
                stream: localStream,
                config: ICE_SERVERS,
                trickle: true,
                debug: true,
                iceTransportPolicy: 'relay'
            });

            peer.on('signal', data => {
                console.log('Отправляем ответный сигнал пользователю:', userId, 'тип:', data.type);
                socket.emit('signal', {
                    userId: userId,
                    signal: data
                });
            });

            peer.on('connect', () => {
                console.log('Установлено ответное peer-соединение');
                try {
                    peer.send('test-connection-response');
                } catch (e) {
                    console.error('Ошибка отправки тестового ответа:', e);
                }
            });

            peer.on('data', data => {
                console.log('Получены данные от пира:', data.toString());
            });

            peer.on('stream', stream => {
                console.log('Получен аудио поток от нового пользователя');
                try {
                    const audio = createAudioElement(userId, stream);
                    document.body.appendChild(audio);
                    handleAudioStream(stream, userId);
                } catch (e) {
                    console.error('Ошибка при создании аудио элемента:', e);
                }
            });

            peer.on('error', err => {
                console.error('Ошибка peer соединения:', err);
                if (peers[userId]) {
                    peers[userId].destroy();
                    delete peers[userId];
                }
            });

            peer.on('close', () => {
                console.log('Закрыто соединение');
                if (peers[userId]) {
                    peers[userId].destroy();
                    delete peers[userId];
                    const audioElement = document.getElementById(`audio-${userId}`);
                    if (audioElement) {
                        audioElement.remove();
                    }
                }
            });

            // Добавляем обработчик ICE состояния
            peer._pc.oniceconnectionstatechange = () => {
                console.log('ICE состояние изменилось:', peer._pc.iceConnectionState);
            };

            peers[userId] = peer;
        }

        console.log('Обрабатываем сигнал от пользователя:', userId);
        peers[userId].signal(signal);
    } catch (error) {
        console.error('Ошибка при обработке сигнала:', error);
    }
});

// После объявления socket добавляем обработчик
socket.on('connection-established', ({ id }) => {
    console.log('Соединение установлено, мой ID:', id);
    mySocketId = id;
});

// Обновляем функцию для создания аудио элемента
function createAudioElement(userId, stream) {
    const audio = document.createElement('audio');
    audio.id = `audio-${userId}`;
    audio.autoplay = true;
    audio.playsInline = true;
    audio.srcObject = stream;
    
    // Устанавливаем сохраненную громкость
    audio.volume = getUserVolume(userId) / 100;
    
    audio.oncanplay = () => {
        console.log('Аудио готово к воспроизведению');
        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise
                .then(() => console.log('Воспроизведение началось успешно'))
                .catch(e => {
                    console.error('Ошибка воспроизведения:', e);
                    document.body.addEventListener('click', () => {
                        audio.play().catch(console.error);
                    }, { once: true });
                });
        }
    };
    
    return audio;
}

// Добавляем обработчик ошибок от сервера
socket.on('error', (message) => {
    alert('Ошибка: ' + message);
    const roomsContainer = document.querySelector('.rooms');
    roomsContainer.style.opacity = '1';
});

// Функция для выхода из комнаты
function leaveRoom() {
    if (currentRoom) {
        socket.emit('leave-room', { room: currentRoom });
        
        // Очищаем все peer-соединения
        Object.keys(peers).forEach(userId => {
            if (peers[userId]) {
                peers[userId].destroy();
                delete peers[userId];
            }
        });
        
        // Останавливаем все треки локального стрима
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        
        // Останавливаем музыку
        stopAllMusic();
        
        // Скрываем интерфейс комнаты
        const roomInterface = document.querySelector('.room');
        if (roomInterface) {
            roomInterface.style.display = 'none';
        }
        
        // Показываем контейнер с выбором комнаты
        const container = document.querySelector('.container');
        if (container) {
            container.style.display = 'block';
        }
        
        currentRoom = null;
        selectedRoom = null;
        
        // Очищаем все аудио элементы
        document.querySelectorAll('audio').forEach(audio => {
            if (audio.id !== 'audio-self') {
                audio.remove();
            }
        });
    }
}

// Функция для переключения микрофона
function toggleMute() {
    if (!localStream) return;
    
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
    });
    
    const muteBtn = document.querySelector('.mute-btn');
    if (muteBtn) {
        const icon = muteBtn.querySelector('i');
        if (icon) {
            icon.className = isMuted ? 'fas fa-microphone-slash' : 'fas fa-microphone';
        }
        muteBtn.classList.toggle('active', isMuted);
    }
    
    // Оповещаем сервер о изменении состояния микрофона
    if (currentRoom) {
        socket.emit('user-mute-change', {
            room: currentRoom,
            muted: isMuted
        });
    }
}

// Добавляем функцию для переключения "слышать себя"
function toggleHearSelf() {
    canHearSelf = !canHearSelf;
    if (localStream) {
        const audioElement = document.getElementById('audio-self');
        if (canHearSelf) {
            if (!audioElement) {
                const audio = document.createElement('audio');
                audio.id = 'audio-self';
                audio.autoplay = true;
                audio.srcObject = localStream;
                audio.volume = 0.5; // Устанавливаем громкость на 50%
                document.body.appendChild(audio);
            }
        } else {
            const audioElement = document.getElementById('audio-self');
            if (audioElement) {
                audioElement.remove();
            }
        }
    }
    
    // Обновляем иконку кнопки
    const hearSelfBtn = document.querySelector('.hear-self-btn');
    if (hearSelfBtn) {
        const icon = hearSelfBtn.querySelector('i');
        if (icon) {
            icon.className = canHearSelf ? 'fas fa-volume-up' : 'fas fa-volume-mute';
        }
        hearSelfBtn.classList.toggle('active', canHearSelf);
    }
}

// Функция для воспроизведения звука
function playSound(sound) {
    sound.currentTime = 0;
    sound.play().catch(error => console.error('Ошибка воспроизведения звука:', error));
}
