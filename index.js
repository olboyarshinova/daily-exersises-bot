const {google} = require('googleapis');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
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
    {command: '/help', description: 'ℹ️  Помощь'},
]);

const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({version: 'v4', auth});

let scheduledTime = '0 7 * * *'; // По умолчанию: 7:00 утра
let scheduledTask = cron.schedule(scheduledTime, () => {
    checkDatesAndSendMessages();
});

async function getSheetData() {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEETS_ID,
            range: "A:Z",
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

function transposeData(data) {
    return data[0].map((_, colIndex) => data.map(row => row[colIndex]));
}

function sendMessage(chatId, message) {
    bot.sendMessage(chatId, message);
}

async function checkDatesAndSendMessages() {
    const data = await getSheetData();

    if (!data) {
        console.log('Данные не получены 1.');
        return;
    }

    const transposedData = transposeData(data);
    console.log('Транспонированные данные:', transposedData);

    const columnNames = transposedData[0];
    console.log('Названия колонок:', columnNames);

    if (!columnNames || columnNames.length === 0) {
        console.log('Заголовки колонок отсутствуют.');
        return;
    }

    const rows = data.slice(1);
    console.log('Данные:', rows);

    // Сегодняшняя дата в формате "DD.MM"
    const today = new Date().toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
    }).replace(/\./g, '.');

    console.log('Сегодняшняя дата:', today);

    for (const row of rows) {
        const date = row[0];
        const time = row[4];
        const url = row[7];


        if (date === today) {
            console.log('Найдено совпадение:', url);

            db.all('SELECT chatId FROM users', (err, users) => {
                if (err) {
                    console.error('Ошибка при получении пользователей:', err);
                    return;
                }

                const videoTime = timeToMilliseconds(time)
                console.log('videoTime', videoTime)

                users.forEach(user => {
                    sendMessage(user.chatId, `Сегодняшнее видео: ${url}`);

                    setTimeout(() => {
                        bot.sendMessage(user.chatId, 'Видео закончилось. Напиши свой комментарий:');
                        bot.once('message', async (msg) => {
                            const comment = msg.text;
                            await saveCommentToSheet(msg.from.username, comment);
                            bot.sendMessage(user.chatId, 'Спасибо за комментарий!');
                        });
                    }, 3000); // заменить на videoTime !!!
                });
            });

            break;
        }
    }
}

function timeToMilliseconds(time) {
    const [hours, minutes] = time.split(':').map(Number);
    const hoursInMs = hours * 3_600_000;
    const minutesInMs = minutes * 60_000;

    return hoursInMs + minutesInMs;
}

async function saveCommentToSheet(userName, comment) {
    console.log(userName, comment)
    try {
        const response = await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEETS_ID,
            range: 'A:Z',
            valueInputOption: 'RAW',
            resource: {
                values: [[userName, comment]],
            },
        });

        console.log('Комментарий сохранен:', response.data);
    } catch (error) {
        console.error('Ошибка при сохранении комментария:', error);
    }
}

bot.onText(/\/settime (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const time = match[1]; // Время в формате "HH:mm"

    if (!match || !match[1]) {
        bot.sendMessage(chatId, 'Необходимо указать время в формате "HH:mm", например, 09:00 или 16:20.');
        return;
    }

    const timePattern = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

    if (!timePattern.test(time)) {
        bot.sendMessage(chatId, 'Неправильный формат времени. Используйте формат HH:mm, например, 09:00 или 16:20.');
        return;
    }

    // Преобразуем время в формат cron
    const [hours, minutes] = time.split(':');
    // Обновляем время
    scheduledTime = `${minutes} ${hours} * * *`;
    // Останавливаем старую задачу
    scheduledTask.stop();
    // Запускаем новую задачу с обновленным временем
    scheduledTask = cron.schedule(scheduledTime, () => {
        checkDatesAndSendMessages();
    });

    bot.sendMessage(chatId, `Время уведомлений изменено на ${time}.`);
});

bot.onText(/\/settime/, (msg, match) => {
    const chatId = msg.chat.id;

    if (match.input === '/settime') {
        bot.sendMessage(chatId, 'Укажите /settime вместе со временем в формате "HH:mm", например, "/settime 09:00".');
    }
});

bot.onText(/\/today/, async (msg) => {
    const chatId = msg.chat.id;
    const data = await getSheetData();

    if (!data) {
        bot.sendMessage(chatId, 'Данные не получены 2.');
        return;
    }

    const rows = data.slice(1);

    // Получаем сегодняшнюю дату в формате "DD.MM"
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

        // Сравниваем даты как строки (без учета времени)
        const [day, month] = date.split('.');
        const [todayDay, todayMonth] = todayFormatted.split('.');

        // Преобразуем даты в числа для корректного сравнения
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
        'INSERT OR IGNORE INTO users (chatId, username, firstName, lastName) VALUES (?, ?, ?, ?)',
        [chatId, username, firstName, lastName],
        (err) => {
            if (err) {
                console.error('err 1', err.message);
                return bot.sendMessage(chatId, 'Произошла ошибка при сохранении ваших данных.');
            }

            console.log(`Пользователь ${username} добавлен в базу данных`);

            bot.sendMessage(
                chatId,
                `Привет, ${firstName}! Добро пожаловать! Бот запущен. Используйте /settime HH:mm для настройки времени уведомлений. Время по умолчанию 7:00`,
            );
        }
    );
});

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const helpText = `
        Доступные команды:
        /start - Запустить/обновить бота
        /settime HH:mm - Установить время уведомлений
        /today - Получить сегодняшнее видео
        /list - Список всех видео
        /help - Показать это сообщение
    `;
    bot.sendMessage(chatId, helpText);
});

bot.onText(/\/me/, (msg) => {
    const chatId = msg.chat.id;

    db.get('SELECT * FROM users WHERE chatId = ?', [chatId], (err, row) => {
        if (err) {
            return console.error('err 2', err.message);
        }

        if (row) {
            bot.sendMessage(chatId, `Ваш username: ${row.username}`);
        } else {
            bot.sendMessage(chatId, 'Вы не зарегистрированы.');
        }
    });
});
