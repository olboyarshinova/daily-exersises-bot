const {google} = require('googleapis');
const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');

const TELEGRAM_BOT_TOKEN = '8196294514:AAEusG4ywhEDhlfksAO4her-aCNl2Z-Z5GY';
const GOOGLE_SHEETS_ID = '1aTH3JD502IqCX2ZG542aHodBTBBG2DzP177aY_zeSZA';
const GOOGLE_CREDENTIALS = require('./single-scholar-395919-2a598adf8152.json');

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {polling: true});

bot.setMyCommands([
    {command: '/start', description: '♻️  Обновить бота'},
    {command: '/settime', description: '🕗  Установить время уведомлений'},
    {command: '/today', description: '🎥  Получить сегодняшнее видео'},
    {command: '/list', description: '📋  Список всех видео'},
    {command: '/mytime', description: '⏰  Установленное время уведомлений'},
    {command: '/help', description: 'ℹ️  Помощь'},
]);

const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({version: 'v4', auth});
const userStates = {};
const userVideoState = {};
const userTimers = {};

setInterval(checkAndSendNotifications, 30000);

async function getSheetData() {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEETS_ID,
            range: 'Зарядки!A:Z',
        });

        if (!response.data.values || response.data.values.length === 0) {
            console.log('Таблица пуста или данные отсутствуют.');
            return null;
        }

        return response.data.values;
    } catch (error) {
        console.error('Ошибка при получении данных из Google Sheets:', error);
        return null;
    }
}

async function checkAndSendNotifications() {
    try {
        console.log('Запуск проверки уведомлений...');
        const now = new Date();
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        const hasVideoToday = await checkForTodayVideo();

        if (!hasVideoToday) {
            console.log('На сегодня видео не найдено');
            return;
        }

        const rows = await new Promise((resolve, reject) => {
            db.all(`SELECT DISTINCT chatId FROM users WHERE notificationTime = ?`, [currentTime], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });

        console.log(`Найдено ${rows.length} пользователей для уведомления в ${currentTime}`);

        await Promise.all(rows.map(row => sendVideoNotification(row.chatId)));

    } catch (error) {
        console.error('Ошибка в checkAndSendNotifications:', error);
    }
}

async function checkForTodayVideo() {
    const data = await getSheetData();

    if (!data) {
        return false;
    }

    const today = new Date().toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
    }).replace(/\./g, '.');

    return data.some(row => row[0] === today);
}

async function sendVideoNotification(chatId) {
    try {
        const data = await getSheetData();
        if (!data?.length) {
            console.log('Нет данных из таблицы');
            return;
        }

        const today = new Date().toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
        }).replace(/\./g, '.');

        const todayVideo = data.find(row => row[0] === today);

        if (!todayVideo) {
            console.log('Видео на сегодня не найдено');
            return;
        }

        const [date, , , , time, , , url] = todayVideo;

        if (await checkIfVideoSentToday(chatId, date)) {
            console.log(`Видео уже отправлено ${chatId} сегодня`);
            return;
        }

        await bot.sendMessage(chatId, `Сегодняшнее видео: ${url}`);
        await markVideoAsSent(chatId, date);

        const videoDurationMs = timeToMilliseconds(time);

        if (!videoDurationMs || isNaN(videoDurationMs)) {
            console.error('Некорректное время видео');
            return;
        }

        const reminderTime = videoDurationMs + 60000;

        if (userTimers[chatId]) {
            clearTimeout(userTimers[chatId]);
            delete userTimers[chatId];
        }

        userTimers[chatId] = setTimeout(async () => {
            try {
                await bot.sendMessage(
                    chatId,
                    'Вы можете оставить комментарий к видео, используя команду /comment'
                );

                userVideoState[chatId] = {
                    videoUrl: url,
                    date: date
                };

            } catch (error) {
                console.error('Ошибка при отправке напоминания:', error);
            }
        }, reminderTime);

    } catch (error) {
        console.error('Ошибка в sendVideoNotification:', error);
    }
}

function timeToMilliseconds(timeStr) {
    if (!timeStr) {
        return 0;
    }

    try {
        const minutesMatch = timeStr.match(/^(\d+)\s*минут[ы]?$/i);

        if (minutesMatch) {
            const minutes = parseInt(minutesMatch[1]) || 0;
            return minutes * 60 * 1000;
        }

        const parts = timeStr.split(':');

        if (parts.length === 2) {
            const minutes = parseInt(parts[0]) || 0;
            const seconds = parseInt(parts[1]) || 0;

            return (minutes * 60 + seconds) * 1000;
        } else if (parts.length === 3) {
            const hours = parseInt(parts[0]) || 0;
            const minutes = parseInt(parts[1]) || 0;
            const seconds = parseInt(parts[2]) || 0;

            return (hours * 3600 + minutes * 60 + seconds) * 1000;
        } else {
            console.error('Неверный формат времени:', timeStr);
            return 0;
        }
    } catch (error) {
        console.error('Ошибка преобразования времени:', error);
        return 0;
    }
}

async function checkIfVideoSentToday(chatId, date) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT 1 FROM sent_videos WHERE chatId = ? AND date = ?`,
            [chatId, date],
            (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(!!row);
                }
            }
        );
    });
}

async function markVideoAsSent(chatId, date) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT OR IGNORE INTO sent_videos (chatId, date) VALUES (?, ?)`,
            [chatId, date],
            function (err) {
                if (err) {
                    console.error('Ошибка при отметке видео:', err);
                    reject(err);
                } else {
                    if (this.changes > 0) {
                        console.log(`Отмечено отправленное видео для ${chatId}`);
                    }

                    resolve();
                }
            }
        );
    });
}

function waitForUserComment(chatId, timeout) {
    return new Promise((resolve) => {
        const listener = (msg) => {
            if (msg.chat.id === chatId && !msg.text.startsWith('/')) {
                cleanup();
                resolve(msg);
            }
        };

        const timer = setTimeout(() => {
            cleanup();
            resolve(null);
        }, timeout);

        const cleanup = () => {
            bot.removeListener('message', listener);
            clearTimeout(timer);
        };

        bot.on('message', listener);
    });
}

async function saveCommentToSheet(userId, userName, comment) {
    console.log(`Сохранение комментария для userId:${userId}`);

    try {
        const todayFormatted = new Date().toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit'
        });
        const sheetName = "Зарядки";
        const firstName = (userName || 'User').split(' ')[0];
        const columnTitle = `Отзыв ${firstName} (${userId})`;
        const valuesResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEETS_ID,
            range: `${sheetName}!A:Z`,
        });
        const rows = valuesResponse.data.values || [];

        let todayRowNum = rows.findIndex(row => row[0] === todayFormatted) + 1;

        if (todayRowNum === 0) {
            await sheets.spreadsheets.values.append({
                spreadsheetId: GOOGLE_SHEETS_ID,
                range: `${sheetName}!A:A`,
                valueInputOption: 'USER_ENTERED',
                resource: {values: [[todayFormatted]]}
            });
            todayRowNum = rows.length + 1;
        }

        let userColumnLetter = 'B';

        if (rows[0]) {
            for (let i = 1; i < rows[0].length; i++) {
                if (rows[0][i] === columnTitle) {
                    userColumnLetter = getColumnLetter(i + 1);
                    break;
                }
            }
        }

        if (userColumnLetter === 'B' && rows[0]?.length > 1) {
            userColumnLetter = getColumnLetter(rows[0].length + 1);

            await sheets.spreadsheets.values.update({
                spreadsheetId: GOOGLE_SHEETS_ID,
                range: `${sheetName}!${userColumnLetter}1`,
                valueInputOption: 'USER_ENTERED',
                resource: {values: [[columnTitle]]}
            });
        }

        const range = `${sheetName}!${userColumnLetter}${todayRowNum}`;

        await sheets.spreadsheets.values.update({
            spreadsheetId: GOOGLE_SHEETS_ID,
            range: range,
            valueInputOption: 'USER_ENTERED',
            resource: {values: [[comment]]}
        });

        console.log(`Комментарий сохранен в ${range}`);
        return true;

    } catch (error) {
        console.error('Ошибка сохранения:', error);
        throw new Error('Не удалось сохранить комментарий');
    }
}

function getColumnLetter(columnIndex) {
    let letter = '';

    while (columnIndex > 0) {
        const remainder = (columnIndex - 1) % 26;
        letter = String.fromCharCode(65 + remainder) + letter;
        columnIndex = Math.floor((columnIndex - 1) / 26);
    }
    return letter || 'A';
}

bot.onText(/\/settime$/, (msg) => {
    const chatId = msg.chat.id;

    bot.sendMessage(chatId, 'Выберите время уведомлений:', {
        reply_markup: {
            inline_keyboard: [
                [{text: "07:00", callback_data: "settime_07:00"}],
                [{text: "08:00", callback_data: "settime_08:00"}],
                [{text: "09:00", callback_data: "settime_09:00"}],
                [{text: "12:00", callback_data: "settime_12:00"}],
                [{text: "15:00", callback_data: "settime_15:00"}],
                [{text: "18:00", callback_data: "settime_18:00"}],
                [{text: "Другое время...", callback_data: "settime_custom"}],
            ]
        }
    });
});

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data.startsWith('settime_')) {
        const time = data.split('_')[1];

        if (time === 'custom') {
            bot.editMessageReplyMarkup(
                {inline_keyboard: []},
                {chat_id: chatId, message_id: query.message.message_id}
            );
            bot.sendMessage(chatId, 'Введите время вручную в формате HH:mm (например 9:30).');
            bot.answerCallbackQuery(query.id);

            userStates[chatId] = {waitingForTimeInput: true};
            return;
        }

        bot.editMessageReplyMarkup(
            {inline_keyboard: []},
            {chat_id: chatId, message_id: query.message.message_id},
        ).then(() => {
            saveNotificationTime(chatId, time, query.id);
        }).catch(error => {
            console.error('Ошибка при закрытии меню:', error);
            saveNotificationTime(chatId, time, query.id);
        });
    }
});

bot.on('text', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    if (text === '/start') {
        return;
    }

    if (userStates[chatId] && userStates[chatId].waitingForTimeInput) {
        const timeRegex = /^(\d{1,2}):(\d{2})$/;
        const match = text.match(timeRegex);

        if (match) {
            let hours = parseInt(match[1], 10);
            let minutes = parseInt(match[2], 10);

            if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
                const formattedTime =
                    `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

                saveNotificationTime(chatId, formattedTime, null);
                delete userStates[chatId];
            } else {
                bot.sendMessage(chatId, 'Неверное время. Часы должны быть от 0 до 23, а минуты от 0 до 59.');
            }
        } else {
            bot.sendMessage(chatId, 'Неверный формат времени. Пожалуйста, введите время в формате HH:mm (например, 9:30 или 07:45)');
        }
    }
});

function saveNotificationTime(chatId, time, callbackQueryId = null) {
    db.run(
        `INSERT OR REPLACE INTO users (chatId, notificationTime) VALUES (?, ?)`,
        [chatId, time],
        (err) => {
            if (callbackQueryId) {
                bot.answerCallbackQuery(callbackQueryId);
            }

            if (err) {
                console.error(err);
                bot.sendMessage(chatId, 'Произошла ошибка при сохранении времени.');
                return;
            }

            console.log(`Для пользователя ${chatId} время уведомлений изменено на ${time}.`)
            bot.sendMessage(chatId, `Теперь уведомления будут приходить в ${time}.`);
        }
    );
}

bot.onText(/\/today/, async (msg) => {
    const chatId = msg.chat.id;
    const data = await getSheetData();

    if (!data) {
        bot.sendMessage(chatId, 'Данные не получены 2.');
        return;
    }

    const rows = data.slice(1);

    // Сегодняшняя дата в формате "DD.MM"
    const today = new Date().toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
    }).replace(/\./g, '.');

    for (const row of rows) {
        const date = row[0];
        const url = row[7];

        if (date === today) {
            bot.sendMessage(chatId, `Сегодняшнее видео: ${url}`);
            return;
        }
    }

    bot.sendMessage(chatId, 'На сегодня видео не найдено.');
});

bot.onText(/\/list/, async (msg) => {
    const chatId = msg.chat.id;
    const data = await getSheetData();

    if (!data) {
        bot.sendMessage(chatId, 'Данные не получены.');
        return;
    }

    const rows = data.slice(1);

    // Сегодняшняя дата в формате "DD.MM"
    const today = new Date();
    const todayFormatted = today.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
    }).replace(/\./g, '.');

    let table = '```\n';
    table += '| Дата  | Время |   Направление   |\n';
    table += '|-------|-------|-----------------|\n';

    for (const row of rows) {
        const date = row[0];
        const time = row[4];
        const type = row[5];

        if (!/^\d{2}\.\d{2}$/.test(date)) {
            console.error(`Некорректный формат даты: ${date}`);
            continue;
        }

        const [day, month] = date.split('.');
        const [todayDay, todayMonth] = todayFormatted.split('.');
        const rowDateNumber = parseInt(month + day, 10); // MMDD
        const todayDateNumber = parseInt(todayMonth + todayDay, 10); // MMDD

        if (rowDateNumber >= todayDateNumber) {
            table += `| ${date.padEnd(5, ' ')} | ${time.padEnd(5, ' ')} | ${type.padEnd(15, ' ')} |\n`;
        }
    }

    table += '```';

    bot.sendMessage(chatId, table, {parse_mode: 'Markdown'});
});

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username;
    const firstName = msg.from.first_name;
    const lastName = msg.from.last_name;

    db.run(
        'INSERT OR IGNORE INTO users (chatId, username, firstName, lastName, notificationTime) VALUES (?, ?, ?, ?, ?)',
        [chatId, username, firstName, lastName, '07:00'],
        (err) => {
            if (err) {
                console.error('Ошибка при сохранении данных:', err.message);
                return bot.sendMessage(chatId, 'Произошла ошибка при сохранении ваших данных.');
            }

            console.log(`Пользователь ${username} добавлен в базу данных`);

            db.get('SELECT notificationTime FROM users WHERE chatId = ?', [chatId], async (err, row) => {
                if (err) {
                    return console.error('Ошибка при получении времени уведомлений:', err.message);
                }

                const notificationTime = row?.notificationTime || '07:00';

                await resetVideoSentStatus(chatId);
                await updateUserInDatabase(chatId, username, firstName, lastName);

                bot.sendMessage(
                    chatId,
                    `Привет, ${firstName}! Добро пожаловать! Используйте /settime для настройки времени уведомлений. Текущее время уведомлений: ${notificationTime}.`,
                );
            });
        }
    );
});

async function resetVideoSentStatus(chatId) {
    const today = new Date().toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
    }).replace(/\./g, '.');

    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM sent_videos WHERE chatId = ? AND date = ?`, [chatId, today], (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

async function updateUserInDatabase(chatId, username, firstName, lastName) {
    return new Promise((resolve, reject) => {
        db.run(`
            INSERT OR REPLACE INTO users (chatId, username, firstName, lastName, notificationTime) 
            VALUES (?, ?, ?, ?, ?)
        `, [chatId, username, firstName, lastName, '07:00'], (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const helpText = `
        Доступные команды:
/start - Запустить/обновить бота
/settime - Установить время уведомлений
/today - Получить сегодняшнее видео
/list - Список всех видео
/mytime - Установленное время уведомлений
/help - Показать это сообщение
    `;
    bot.sendMessage(chatId, helpText);
});

bot.onText(/\/mytime/, (msg) => {
    const chatId = msg.chat.id;

    db.get('SELECT * FROM users WHERE chatId = ?', [chatId], (err, row) => {
        if (err) {
            return console.error('Ошибка при получении данных:', err.message);
        }

        if (row) {
            bot.sendMessage(chatId, `Время уведомлений: ${row.notificationTime || '07:00'}`);
        } else {
            bot.sendMessage(chatId, 'Вы не зарегистрированы.');
        }
    });
});

bot.onText(/\/comment/, async (msg) => {
    const chatId = msg.chat.id;

    try {
        await bot.sendMessage(chatId, 'Пожалуйста, напишите ваш комментарий к видео:');

        const response = await waitForUserComment(chatId, 600000);

        if (Object.keys(userVideoState).length) {
            if (response && response.text) {
                await saveCommentToSheet(
                    response.from.id,
                    response.from.first_name || '',
                    response.text,
                    userVideoState[chatId]?.date,
                    userVideoState[chatId]?.videoUrl,
                );

                await bot.sendMessage(chatId, 'Спасибо за ваш комментарий!');

                delete userVideoState[chatId];
            }
        } else {
            console.error('Комменатрий уже был сохранен для ', chatId);
            await bot.sendMessage(chatId, 'Комменатрий уже был сохранен.');
        }
    } catch (error) {
        console.error('Ошибка при обработке комментария:', error);
        await bot.sendMessage(chatId, 'Произошла ошибка при сохранении комментария.');
    }
});
