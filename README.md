# Voice Chat Application

WebRTC-based voice chat application with room support.

## Features

- Real-time voice communication
- Multiple chat rooms
- Individual volume controls
- Modern dark theme UI

## Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd voice-chat-app
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## Environment Variables

- `PORT` - Server port (default: 3000)

## Tech Stack

- Node.js
- Express
- Socket.IO
- WebRTC

## Особенности

- Пять фиксированных комнат для общения
- Вход без регистрации (только имя пользователя)
- Управление микрофоном
- Возможность отключения звука отдельных пользователей
- Тёмная тема
- Минимальное потребление ресурсов
- Скрытая админ-панель со статистикой

## Установка

1. Убедитесь, что у вас установлен Node.js версии 14 или выше
2. Клонируйте репозиторий:
```bash
git clone [url-репозитория]
cd voice-chat-app
```

3. Установите зависимости:
```bash
npm install
```

## Запуск

Для разработки (с автоматической перезагрузкой):
```bash
npm run dev
```

Для продакшена:
```bash
npm start
```

Приложение будет доступно по адресу: `http://localhost:3000`

## Использование

1. Откройте приложение в браузере
2. Введите своё имя
3. Выберите комнату для входа
4. Разрешите доступ к микрофону
5. Используйте кнопки управления для включения/выключения микрофона
6. Для выхода из комнаты нажмите кнопку "Выйти"

## Админ-панель

Статистика доступна по адресу: `http://localhost:3000/admin-stats`

## Технические требования

- Современный браузер с поддержкой WebRTC
- Микрофон
- Node.js 14+

## Используемые технологии

- Node.js
- Express
- Socket.IO
- WebRTC (simple-peer)
- HTML5/CSS3
- JavaScript (ES6+) #   t e a m _ s p e a k 
 
 