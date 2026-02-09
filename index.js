const {google} = require('googleapis');
const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');
const {TELEGRAM_BOT_TOKEN, GOOGLE_CREDENTIALS, GOOGLE_SHEETS_ID, ADMIN_ID} = require('./constants');

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {polling: true});

bot.setMyCommands([
    {command: '/start', description: '♻️  Обновить бота'},
    {command: '/settime', description: '🕗  Установить время уведомлений'},
    {command: '/today', description: '🎥  Получить сегодняшнее видео'},
    {command: '/list', description: '📋  Список всех видео'},
    {command: '/mytime', description: '⏰  Установленное время уведомлений'},
    {command: '/report', description: '🚨  Уведомить об ошибке'},
]);

const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({version: 'v4', auth});
const userStates = {};
const userVideoState = {};
const userTimers = {};
let isReportScheduled = false;

scheduleDailyReport(bot);
setInterval(checkAndSendNotifications, 30000);
testConnection();

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
            db.all(`
                SELECT DISTINCT chatId, firstName
                FROM users 
                WHERE notificationTime = ? 
                AND isActive = 1
            `, [currentTime], (err, rows) => {
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

        const [date, , , author, time, type, level, url, comment] = todayVideo;

        if (await checkIfVideoSentToday(chatId, date)) {
            console.log(`Видео уже отправлено ${chatId} сегодня`);
            return;
        }

        try {
            const thumbnailUrl = getYouTubeThumbnail(url) || 'https://via.placeholder.com/1280x720.png?text=Video+Preview';
            await bot.sendPhoto(chatId, thumbnailUrl, {
                caption: `Сегодняшняя тренировка

Автор: ${author}
Длительность: ${time}
Направление: ${type}
Сложность: ${getDifficultyStars(level)}
ВПН: ${url.includes('youtube') ? 'нужен' : 'не нужен'}
${comment ? `\n💬 Комментарий: ${comment}` : ''}`,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: 'Смотреть видео',
                                url: url,
                            },
                        ],
                    ],
                },
            });
            await markVideoAsSent(chatId, date);

            const videoDurationMs = timeToMilliseconds(time);

            if (videoDurationMs && !isNaN(videoDurationMs)) {
                const reminderTime = videoDurationMs + 60000 * 3;

                if (userTimers[chatId]) {
                    clearTimeout(userTimers[chatId]);
                    delete userTimers[chatId];
                }

                userTimers[chatId] = setTimeout(async () => {
                    try {
                        await bot.sendMessage(
                            chatId,
                            `Оцените сегодняшнюю тренировку.
Ваша оценка улучшит подбор упражнений!`,
                            {
                                reply_markup: {
                                    inline_keyboard: [
                                        [
                                            {text: "1", callback_data: "rate_1"},
                                            {text: "2", callback_data: "rate_2"},
                                            {text: "3", callback_data: "rate_3"},
                                            {text: "4", callback_data: "rate_4"},
                                            {text: "5", callback_data: "rate_5"},
                                        ],
                                        [
                                            {text: "Пропустить", callback_data: "skip_rating"},
                                        ],
                                    ],
                                },
                            },
                        );

                        userVideoState[chatId] = {
                            videoUrl: url,
                            date: date,
                        };

                    } catch (error) {
                        console.error('Ошибка при отправке напоминания:', error);
                    }
                }, reminderTime);

            } else {
                console.error('Некорректное время видео');
            }
        } catch (error) {
            console.error(`Ошибка в sendVideoNotification (${chatId}):`, error);

            try {
                await bot.sendMessage(chatId, `⚠️ Произошла ошибка при отправке видео...`);
            } catch (sendError) {
                console.error('Ошибка при отправке сообщения об ошибке:', chatId, sendError);

                if (sendError.response && sendError.response.statusCode === 403) {
                    await deactivateUser(chatId);
                }
            }
        }
    } catch (error) {
        console.error(`Ошибка в sendVideoNotification (${chatId}):`, error);
        try {
            await bot.sendMessage(chatId, `⚠️ Произошла ошибка при отправке видео. Попробуйте позже.
            
Вы можете уведомить об ошибке по команде /report`);
        } catch (sendError) {
            console.error('Ошибка при отправке сообщения об ошибке:', chatId, sendError);
        }
    }
}

const getDifficultyStars = (level) => {
    const maxLevel = 5;
    const activeStar = '⭐';
    const inactiveStar = '☆';

    return activeStar.repeat(level) + inactiveStar.repeat(maxLevel - level);
};

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
                    console.error('Ошибка при отметке видео:', err, chatId);
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
        const listener = async (msg) => {
            if (msg.chat.id === chatId && !msg.text.startsWith('/')) {
                await cleanup();
                resolve(msg);
            }
        };
        const timer = setTimeout(async () => {
            await cleanup();
            resolve(null);
        }, timeout);
        const cleanup = async () => {
            await bot.removeListener('message', listener);
            clearTimeout(timer);
        };

        bot.on('message', listener);
    });
}

async function saveCommentToSheet(userId, userName, comment, date) {
    try {
        const todayFormatted = date || new Date().toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
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
                resource: {values: [[todayFormatted]]},
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
                resource: {values: [[columnTitle]]},
            });
        }

        const range = `${sheetName}!${userColumnLetter}${todayRowNum}`;

        await sheets.spreadsheets.values.update({
            spreadsheetId: GOOGLE_SHEETS_ID,
            range: range,
            valueInputOption: 'USER_ENTERED',
            resource: {values: [[comment]]},
        });

        console.log(`Комментарий сохранен в ${range}`);

        return true;
    } catch (error) {
        console.error('Ошибка сохранения в Google Sheets:', error, userId);
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

bot.onText(/\/settime$/, async (msg) => {
    const chatId = msg.chat.id;

    await bot.sendMessage(chatId, 'Выберите время уведомлений (московское время):', {
        reply_markup: {
            inline_keyboard: [
                [{text: "07:00", callback_data: "settime_07:00"}],
                [{text: "08:00", callback_data: "settime_08:00"}],
                [{text: "09:00", callback_data: "settime_09:00"}],
                [{text: "12:00", callback_data: "settime_12:00"}],
                [{text: "15:00", callback_data: "settime_15:00"}],
                [{text: "18:00", callback_data: "settime_18:00"}],
                [{text: "Другое время...", callback_data: "settime_custom"}],
            ],
        },
    });
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    try {
        if (data === 'skip_rating') {
            await bot.answerCallbackQuery(query.id);
            await bot.editMessageText(
                'Хорошо! Если передумаете - оцените тренировку позже по команде /comment',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                },
            );

            return;
        }

        if (data === 'skip_comment') {
            await bot.answerCallbackQuery(query.id);
            await bot.editMessageText(
                'Спасибо за вашу оценку! Если передумаете - добавьте комментарий позже по команде /comment',
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                }
            );
            delete userStates[chatId];

            return;
        }

        if (data.startsWith('settime_')) {
            const time = data.split('_')[1];

            if (time === 'custom') {
                await bot.editMessageReplyMarkup(
                    {inline_keyboard: []},
                    {chat_id: chatId, message_id: query.message.message_id}
                );
                await bot.sendMessage(chatId, 'Введите время вручную в формате HH:mm (например 9:30).');
                await bot.answerCallbackQuery(query.id);
                userStates[chatId] = {waitingForTimeInput: true};

                return;
            }

            await bot.editMessageReplyMarkup(
                {inline_keyboard: []},
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                },
            );
            await saveNotificationTime(chatId, time, query.id);
            await bot.answerCallbackQuery(query.id);
        } else if (data.startsWith('rate_')) {
            const rating = parseInt(data.split('_')[1]);

            await bot.editMessageReplyMarkup(
                {inline_keyboard: []},
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                },
            );
            await bot.answerCallbackQuery(query.id, {
                text: `Спасибо за оценку ${'⭐'.repeat(rating)}!`,
            });
            await saveCommentToSheet(
                chatId,
                query.from.first_name || 'User',
                `${rating}`,
                userVideoState[chatId]?.date,
                userVideoState[chatId]?.videoUrl,
            );
            await bot.sendMessage(
                chatId,
                rating < 3
                    ? 'Спасибо за оценку! Что необходимо улучшить?'
                    : `Спасибо за оценку!
                    
Хотите добавить комментарий к оценке?

Напишите пару слов о тренировке:
• "Понравилось упражнение на пресс"
• "Хочу больше растяжки"
• "Было сложно, но круто!"`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{text: "Пропустить", callback_data: "skip_comment"}],
                        ],
                    },
                },
            );
            userStates[chatId] = {
                type: 'feedback',
                waitingForComment: true,
                rating: rating,
            };
            userStates[chatId].timeout = setTimeout(() => {
                if (userStates[chatId]?.waitingForComment) {
                    delete userStates[chatId];
                    bot.sendMessage(chatId, "Если захотите оставить комментарий позже - используйте команду /comment");
                }
            }, 300000);
        }

        if (query.data === 'report_cancel') {
            clearTimeout(userStates[chatId]?.timeout);
            delete userStates[chatId];
            await bot.answerCallbackQuery(query.id);
            await bot.editMessageText('Отправка отчета отменена', {
                chat_id: chatId,
                message_id: query.message.message_id,
            });
        }

        if (query.data === 'report_example') {
            await bot.answerCallbackQuery(query.id);
            await bot.sendMessage(chatId,
                'Пример хорошего отчета:\n\n' +
                '• Проблема: при нажатии на /today бот не отвечает\n' +
                '• Время: 15:30 20.05.2023\n' +
                '• Действия: открыл бота → нажал /today → ничего не произошло\n'
            );
            // TODO: добавить возможность отправлять скриншоты
            // '• Дополнительно: Скриншот прикреплен', {
            //     parse_mode: 'HTML',
            //     reply_to_message_id: query.message.message_id,
            // }
        }
    } catch (error) {
        console.error('Ошибка обработки оценки:', error, chatId);
        await bot.answerCallbackQuery(query.id, {
            text: 'Произошла ошибка, попробуйте позже',
        });
    }
});

bot.on('text', async (msg) => {
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
                const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

                saveNotificationTime(chatId, formattedTime, null);
                delete userStates[chatId];
            } else {
                await bot.sendMessage(chatId, `⚠️ Неверное время. Часы должны быть от 0 до 23, а минуты от 0 до 59.
                
Вы можете уведомить об ошибке по команде /report`);
            }
        } else {
            await bot.sendMessage(chatId, `⚠️ Неверный формат времени. Пожалуйста, введите время в формате HH:mm (например, 9:30 или 07:45)
            
Вы можете уведомить об ошибке по команде /report`);
        }
    }
});

function saveNotificationTime(chatId, time, callbackQueryId = null) {
    db.get('SELECT * FROM users WHERE chatId = ?', [chatId], (err, row) => {
        if (err) {
            console.error(`Ошибка при получении пользователя ${chatId}:`, err);
            reject(new Error('DATABASE_ERROR'));
            return;
        }

        if (!row) {
            console.log(`Пользователь ${chatId} не найден`);
            resolve(null);
            return;
        }

        if (!row.chatId || !row.notificationTime) {
            console.error(`Некорректные данные пользователя ${chatId}:`, row);
            reject(new Error('INVALID_USER_DATA'));
            return;
        }

        db.run(
            `INSERT OR REPLACE INTO users 
            (chatId, username, firstName, lastName, notificationTime, isActive) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                chatId,
                row?.username || null,
                row?.firstName || null,
                row?.lastName || null,
                time,
                row?.isActive || 1
            ],
            async (err) => {
                if (callbackQueryId) {
                    await bot.answerCallbackQuery(callbackQueryId);
                }

                if (err) {
                    console.error(err, chatId);
                    await bot.sendMessage(chatId, `⚠️ Произошла ошибка при сохранении времени.
                   
Вы можете уведомить об ошибке по команде /report`);
                    return;
                }

                console.log(`Для пользователя ${chatId} время уведомлений изменено на ${time}.`)
                await bot.sendMessage(chatId, `Теперь уведомления будут приходить в ${time}.`);
            }
        );
    });
}

bot.onText(/\/today/, async (msg) => {
    const chatId = msg.chat.id;
    const data = await getSheetData();

    if (!data) {
        await bot.sendMessage(chatId, `⚠️ Данные не получены.
        
Вы можете уведомить об ошибке по команде /report`);
        return;
    }

    const rows = data.slice(1);
    // Сегодняшняя дата в формате DD.MM
    const today = new Date().toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
    }).replace(/\./g, '.');

    for (const row of rows) {
        const [date, , , author, time, type, level, url, comment] = row;
        const todayVideo = data.find(row => row[0] === today);
        const formattedType = type && type.length > 0
            ? type.charAt(0).toLowerCase() + type.slice(1)
            : type;

        if (!todayVideo) {
            console.log('Видео на сегодня не найдено');
            return;
        }

        if (date === today) {
            const thumbnailUrl = getYouTubeThumbnail(url) || 'https://via.placeholder.com/1280x720.png?text=Video+Preview';
            await bot.sendPhoto(chatId, thumbnailUrl, {
                caption: `Сегодняшняя тренировка

Автор: ${author}
Длительность: ${time}
Направление: ${type}
Сложность: ${getDifficultyStars(level)}
ВПН: ${url.includes('youtube') ? 'нужен' : 'не нужен'}
${comment ? `\n💬 Комментарий: ${comment}` : ''}`,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: 'Смотреть видео',
                                url: url,
                            },
                        ],
                    ],
                },
            });

            return;
        }
    }

    await bot.sendMessage(chatId, `⚠️ На сегодня видео не найдено.
    
Вы можете уведомить об ошибке по команде /report`);
});

bot.onText(/\/list/, async (msg) => {
    const chatId = msg.chat.id;
    const data = await getSheetData();

    if (!data) {
        await bot.sendMessage(chatId, `⚠️ Данные не получены.
        
Вы можете уведомить об ошибке по команде /report`);
        return;
    }

    const rows = data.slice(1);
    // Сегодняшняя дата в формате DD.MM
    const today = new Date();
    const todayFormatted = today.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
    }).replace(/\./g, '.');
    let table = '```\n';

    table += '| Дата  | Длит. |   Направление   |\n';
    table += '|-------|-------|-----------------|\n';

    for (const row of rows) {
        const date = row[0];
        const time = row[4];
        const type = row[5];

        if (!/^\d{2}\.\d{2}$/.test(date)) {
            console.error(`Некорректный формат даты: ${date}`, msg.chat.id);
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
    await bot.sendMessage(chatId, table, {parse_mode: 'Markdown'});
});

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username;
    const firstName = msg.from.first_name;
    const lastName = msg.from.last_name;

    db.run(
        'INSERT OR REPLACE INTO users (chatId, username, firstName, lastName, notificationTime, isActive) VALUES (?, ?, ?, ?, ?, ?)',
        [chatId, username, firstName, lastName, '08:00', 1],
        (err) => {
            if (err) {
                console.error('Ошибка при сохранении данных:', err.message);
                return bot.sendMessage(chatId, `⚠️ Произошла ошибка при сохранении ваших данных.
                
Вы можете уведомить об ошибке по команде /report`);
            }

            console.log(`Пользователь ${username} добавлен в базу данных`);

            db.get('SELECT notificationTime FROM users WHERE chatId = ?', [chatId], async (err, row) => {
                if (err) {
                    return console.error('Ошибка при получении времени уведомлений:', err.message);
                }

                const notificationTime = row?.notificationTime || '08:00';

                await resetVideoSentStatus(chatId);
                await updateUserInDatabase(chatId, username, firstName, lastName);
                await bot.sendMessage(
                    chatId,
                    `Привет, ${firstName}! Добро пожаловать! Используйте /settime для настройки времени уведомлений. Текущее время уведомлений: ${notificationTime} (московское время).`,
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
        `, [chatId, username, firstName, lastName, '08:00'], (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

bot.onText(/\/mytime/, (msg) => {
    const chatId = msg.chat.id;

    db.get('SELECT * FROM users WHERE chatId = ?', [chatId], async (err, row) => {
        if (err) {
            return console.error('Ошибка при получении данных:', err.message);
        }

        if (row) {
            await bot.sendMessage(chatId, `Время уведомлений: ${row.notificationTime || '08:00'}`);
        } else {
            await bot.sendMessage(chatId, `⚠️ Нет установленного времени.
            
Вы можете уведомить об ошибке по команде /report`);
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
        await bot.sendMessage(chatId, `⚠️ Произошла ошибка при сохранении комментария.
        
Вы можете уведомить об ошибке по команде /report`);
    }
});

async function sendDailyReport() {
    try {
        const today = new Date();
        const todayFormatted = `${today.getDate().toString().padStart(2, '0')}.${(today.getMonth() + 1).toString().padStart(2, '0')}`;
        const stats = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    COUNT(*) as total_users,
                    (SELECT COUNT(DISTINCT chatId) FROM sent_videos WHERE date = ?) as actually_received
                FROM users
            `, [todayFormatted], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows[0]);
                }
            });
        });
        const problems = await new Promise((resolve, reject) => {
            db.all(`
                SELECT u.chatId, u.username, u.firstName, u.notificationTime
                FROM users u
                WHERE u.isActive = 1
                AND NOT EXISTS (
                    SELECT 1 FROM sent_videos sv 
                    WHERE sv.chatId = u.chatId 
                    AND sv.date = ?
                )
            `, [todayFormatted], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
        const problemsList = problems.length > 0
            ? problems.map(u => `@${u.username || 'нет'} (${u.firstName})`).join(', ')
            : 'Нет проблемных пользователей';
        const report = `
📊 Ежедневный отчет:
- Всего пользователей: ${stats.total_users}
- Фактически получили: ${stats.actually_received}
- Проблемные пользователи (${problems.length}): ${problemsList}
- Дата: ${today.toLocaleDateString('ru-RU')}
        `;

        await bot.sendMessage(ADMIN_ID, report);
        console.log('Ежедневный отчет отправлен администратору');
    } catch (error) {
        console.error('Ошибка при формировании отчета:', error);
    }
}

function scheduleDailyReport() {
    if (isReportScheduled) {
        return;
    }

    isReportScheduled = true;

    const now = new Date();
    const targetTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        21, 0, 0,
    );

    if (now > targetTime) {
        targetTime.setDate(targetTime.getDate() + 1);
    }

    const timeUntilReport = targetTime - now;

    setTimeout(async () => {
        await sendDailyReport();
        setInterval(sendDailyReport, 24 * 60 * 60 * 1000);
    }, timeUntilReport);
    console.log(`Следующий отчет будет отправлен в ${targetTime.toLocaleTimeString()}`);
}

bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) {
        return;
    }

    const chatId = msg.chat.id;
    const userState = userStates[chatId];

    try {
        if (userState?.waitingForComment) {
            try {
                const currentComment = await getCurrentComment(chatId, userVideoState[chatId]?.date);
                let updatedComment;

                if (currentComment.includes('Оценка:')) {
                    updatedComment = `${currentComment}, ${msg.text}`;
                } else {
                    updatedComment = `${userState.rating}, ${msg.text}`;
                }

                await saveCommentToSheet(
                    chatId,
                    msg.from.first_name || 'User',
                    updatedComment,
                    userVideoState[chatId]?.date,
                    userVideoState[chatId]?.videoUrl,
                );
                delete userStates[chatId];
                await bot.sendMessage(chatId, 'Ваш отзыв сохранен! Спасибо!');
                clearTimeout(userState.timeout);
            } catch (error) {
                console.error('Ошибка сохранения отзыва:', error);
                await bot.sendMessage(chatId, `⚠️ Не удалось отправить отзыв. Попробуйте позже.

Вы можете уведомить об ошибке по команде /report`);
            }
        }

        if (userState?.waitingForErrorReport) {
            try {
                const reportData = {
                    userId: chatId,
                    userName: msg.from.first_name || 'Аноним',
                    text: msg.text,
                    date: new Date(),
                    hasMedia: userState.hasMedia || false,
                    mediaFileId: userState.mediaFileId || null,
                };

                await saveErrorReport(reportData);

                if (userState.hasMedia) {
                    await forwardMediaToAdmin(userState.mediaFileId, userState.mediaType, msg.text);
                }

                await bot.sendMessage(chatId, 'Отчет об ошибке успешно отправлен. Спасибо!');
                delete userStates[chatId];
            } catch (error) {
                console.error('Ошибка сохранения отчета:', error);
                await bot.sendMessage(chatId, `⚠️ Не удалось отправить отчет. Попробуйте позже.

Вы можете уведомить об ошибке по команде /report`);
            }
        }
    } catch (error) {
        if (error.response && error.response.statusCode === 403) {
            await deactivateUser(chatId);
        }
    }
});

async function getCurrentComment(chatId, date) {
    try {
        const todayFormatted = date || new Date().toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
        }).replace(/\./g, '.');
        const sheetName = "Зарядки";
        const user = await bot.getChatMember(chatId, chatId);
        const userName = user?.user?.first_name || 'User';
        const firstName = userName.split(' ')[0];
        const columnTitle = `Отзыв ${firstName} (${chatId})`;
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEETS_ID,
            range: `${sheetName}!A:Z`,
        });
        const rows = response.data.values || [];
        const todayRowIndex = rows.findIndex(row => row[0] === todayFormatted);

        if (todayRowIndex === -1) {
            return '';
        }

        const headerRow = rows[0] || [];
        const userColumnIndex = headerRow.findIndex(cell => cell === columnTitle);

        if (userColumnIndex === -1) {
            return '';
        }

        return rows[todayRowIndex][userColumnIndex] || '';
    } catch (error) {
        console.error('Ошибка при получении комментария:', error);
        return '';
    }
}

bot.onText(/\/report/, async (msg) => {
    const chatId = msg.chat.id;

    await bot.sendMessage(chatId, `🛠 Сообщить об ошибке.
    
Опишите проблему как можно подробнее:
• Что произошло
• Когда возникла ошибка
• Какие действия к ней привели`, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{text: "Пример отчета", callback_data: "report_example"}],
                [{text: "Отменить", callback_data: "report_cancel"}],
            ],
        },
    });
    userStates[chatId] = {
        waitingForErrorReport: true,
        timeout: setTimeout(async () => {
            if (userStates[chatId]?.waitingForErrorReport) {
                await bot.sendMessage(chatId, 'Время на отправку отчета истекло. Используйте /report когда будете готовы.');
                delete userStates[chatId];
            }
        }, 300000)
    };
});

async function saveErrorReport(data) {
    const sheetName = "Ошибки";
    const timestamp = data.date.toLocaleString('ru-RU', {timeZone: 'Europe/Moscow'});

    await sheets.spreadsheets.values.append({
        spreadsheetId: GOOGLE_SHEETS_ID,
        range: `${sheetName}!A:E`,
        valueInputOption: 'USER_ENTERED',
        resource: {
            values: [[
                timestamp,
                data.userId,
                data.userName,
                data.text,
                data.hasMedia ? 'Да' : 'Нет',
            ]],
        },
    });
    await bot.sendMessage(ADMIN_ID, `Пользователь ${data.userName} отправил отчет об ошибке:
${data.text}`)
}

bot.on(['photo', 'document'], async (msg) => {
    const chatId = msg.chat.id;
    const state = userStates[chatId];
    const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

    if (!ALLOWED_FILE_TYPES.includes(msg.document.mime_type)) {
        await bot.sendMessage(msg.chat.id, '⚠️ Поддерживаются только JPG, PNG и PDF');
        return;
    }

    if (msg.document.file_size > 5 * 1024 * 1024) {
        await bot.sendMessage(msg.chat.id, '⚠️ Файл слишком большой (макс. 5MB)');
        return;
    }

    if (state?.waitingForErrorReport) {
        try {
            const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.document.file_id;

            userStates[chatId] = {
                ...state,
                hasMedia: true,
                mediaFileId: fileId,
                mediaType: msg.photo ? 'photo' : 'document',
            };
            await bot.sendMessage(chatId, '📎 Медиафайл получен! Теперь, пожалуйста, опишите проблему текстом:', {
                reply_markup: {
                    inline_keyboard: [
                        [{text: "Отменить отправку", callback_data: "report_cancel"}],
                    ],
                },
            });
        } catch (error) {
            console.error('Ошибка обработки медиафайла:', error);
            await bot.sendMessage(chatId, `⚠️ Не удалось обработать файл. Попробуйте отправить его еще раз.
            
Вы можете уведомить об ошибке по команде /report`);
        }
    }
});

async function forwardMediaToAdmin(fileId, mediaType, caption) {
    try {
        if (mediaType === 'photo') {
            await bot.sendPhoto(ADMIN_ID, fileId, {caption: `Ошибка: ${caption}`});
        } else {
            await bot.sendDocument(ADMIN_ID, fileId, {caption: `Ошибка: ${caption}`});
        }
    } catch (error) {
        console.error('Ошибка пересылки медиа:', error);
    }
}

async function deactivateUser(chatId) {
    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE users SET isActive = 0 WHERE chatId = ?`,
            [chatId],
            function (err) {
                if (err) {
                    console.error('Ошибка деактивации пользователя:', chatId, err);
                    reject(err);
                } else {
                    console.log(`Пользователь ${chatId} заблокировал бота`);
                    resolve();
                }
            }
        );
    });
}

async function testConnection() {
    try {
        console.log('Тестирование соединения с Google Sheets...');
        await sheets.spreadsheets.get({
            spreadsheetId: GOOGLE_SHEETS_ID,
        });
        console.log('✅ Соединение успешно!');

        return true;
    } catch (error) {
        console.error('❌ Ошибка соединения:', error.message);
        console.log('Код ошибки:', error.code);

        return false;
    }
}

function getYouTubeThumbnail(videoUrl) {
    const videoId = videoUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);

    if (videoId && videoId[1]) {
        return `https://img.youtube.com/vi/${videoId[1]}/maxresdefault.jpg`;
    }

    // Если не YouTube или не удалось извлечь ID, можно использовать дефолтное изображение
    return null;
}
