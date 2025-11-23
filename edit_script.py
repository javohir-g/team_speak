import re

# Читаем файл
with open('public/script.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Шаг 1: Заменяем currentMusic на currentDeviceId
content = content.replace('let currentMusic = null;', 'let currentDeviceId = null;')

# Шаг 2: Удаляем musicTracks
pattern = r'// Добавляем музыку\r?\nconst musicTracks = \{[^}]+\};\r?\n'
content = re.sub(pattern, '', content, flags=re.DOTALL)

# Шаг 3: Добавляем инициализацию микрофона после updateRoomsList();
init_code = '''
    
    // Инициализация выбора микрофона
    const micSelect = document.getElementById('micSelect');
    if (micSelect) {
        micSelect.addEventListener('change', async (e) => {
            if (e.target.value) {
                await switchMicrophone(e.target.value);
            }
        });
    }

    // Заполняем список устройств
    getConnectedDevices();

    // Слушаем изменения устройств
    navigator.mediaDevices.addEventListener('devicechange', getConnectedDevices);
'''

content = content.replace('updateRoomsList();', 'updateRoomsList();' + init_code)

# Шаг 4: Находим и удаляем все функции музыки (от "// Функция для воспроизведения музыки" до конца)
music_start = content.find('// Функция для воспроизведения музыки')
if music_start != -1:
    content = content[:music_start]

# Шаг 5: Добавляем функции микрофона
mic_functions = '''
// Получение списка устройств
async function getConnectedDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        const micSelect = document.getElementById('micSelect');
        if (!micSelect) return;

        const currentVal = micSelect.value;
        micSelect.innerHTML = '<option value="" disabled>Выберите микрофон</option>';

        audioInputs.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `Микрофон ${micSelect.length}`;
            micSelect.appendChild(option);
        });

        if (currentVal && audioInputs.some(d => d.deviceId === currentVal)) {
            micSelect.value = currentVal;
        } else if (audioInputs.length > 0) {
            if (localStream) {
                const track = localStream.getAudioTracks()[0];
                const settings = track.getSettings();
                if (settings.deviceId) {
                    micSelect.value = settings.deviceId;
                } else {
                    micSelect.selectedIndex = 1;
                }
            } else {
                micSelect.selectedIndex = 1;
            }
        }
    } catch (error) {
        console.error('Ошибка при получении списка устройств:', error);
    }
}

// Переключение микрофона
async function switchMicrophone(deviceId) {
    try {
        if (!localStream) return;
        
        console.log('Переключение на микрофон:', deviceId);

        const newStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: { exact: deviceId },
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });

        const newTrack = newStream.getAudioTracks()[0];
        newTrack.enabled = !isMuted;

        // Останавливаем старый трек
        localStream.getAudioTracks().forEach(track => track.stop());

        localStream = newStream;

        // Обновляем анализатор звука
        if (microphone) {
            microphone.disconnect();
            microphone = audioContext.createMediaStreamSource(localStream);
            microphone.connect(analyser);
        } else {
            setupAudioAnalyser(localStream);
        }

        // Обновляем трек во всех активных соединениях
        Object.values(peers).forEach(peer => {
            if (peer && !peer.destroyed) {
                const senders = peer._pc.getSenders();
                const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
                if (audioSender) {
                    console.log('Замена трека для пира');
                    audioSender.replaceTrack(newTrack).catch(err => {
                        console.error('Ошибка замены трека:', err);
                    });
                }
            }
        });

        console.log('Микрофон успешно переключен');
    } catch (error) {
        console.error('Ошибка при переключении микрофона:', error);
        alert('Не удалось переключить микрофон: ' + error.message);
    }
}
'''

content += mic_functions

# Записываем обратно
with open('public/script.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Файл успешно обновлен!")
