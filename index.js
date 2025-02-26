const {google} = require('googleapis');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');

// Настройки
const TELEGRAM_BOT_TOKEN = '8196294514:AAEusG4ywhEDhlfksAO4her-aCNl2Z-Z5GY';
const GOOGLE_SHEETS_ID = '1aTH3JD502IqCX2ZG542aHodBTBBG2DzP177aY_zeSZA';
const GOOGLE_CREDENTIALS = require('./single-scholar-395919-e8bc09a060b9.json'); // Путь к JSON-файлу

// Инициализация Telegram-бота
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {polling: true});

// Установка меню команд
bot.setMyCommands([
    {command: '/start', description: 'Обновить бота'},
    {command: '/settime', description: 'Установить время уведомлений'},
    {command: '/today', description: 'Получить сегодняшнее видео'},
    {command: '/list', description: 'Список всех видео'},
    {command: '/help', description: 'Помощь'},
]);

// Инициализация Google Sheets API
const auth = new google.auth.GoogleAuth({
    credentials: GOOGLE_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({version: 'v4', auth});

const userData = {}; // Хранение данных пользователей

// Переменные для хранения chatId и времени уведомления
let chatId = null;
let scheduledTime = '0 7 * * *'; // По умолчанию: 7:00 утра
let scheduledTask = cron.schedule(scheduledTime, () => {
    checkDatesAndSendMessages();
});

// Получение данных из Google Sheets
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
    if (!chatId) {
        console.log('Chat ID не найден.');
        return;
    }

    const data = await getSheetData();

    if (!data) {
        console.log('Данные не получены.');
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

    // Проходим по данным таблицы
    for (const row of rows) {
        const date = row[0]; // Первая колонка — дата
        const url = row[7];  // Восьмая колонка — ссылка

        if (date === today) {
            console.log('Найдено совпадение:', url);
            sendMessage(chatId, `Сегодняшнее видео: ${url}`);

            setTimeout(() => {
                bot.sendMessage(chatId, 'Видео закончилось. Напиши свой комментарий:');
                bot.once('message', async (msg) => {
                    const comment = msg.text;
                    await saveCommentToSheet(userData[chatId].userName, comment); // Сохраняем комментарий
                    bot.sendMessage(chatId, 'Спасибо за комментарий!');
                });
            }, 1000);

            break;
        }
    }
}

// Функция для сохранения комментария
// Функция для сохранения комментария
async function saveCommentToSheet(userName, comment) {
    try {
        const response = await sheets.spreadsheets.values.append({
            spreadsheetId: GOOGLE_SHEETS_ID,
            range: 'Comments!A:B', // Диапазон для записи комментариев
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

// Настройка времени уведомлений
bot.onText(/\/settime (.+)/, (msg, match) => {
    let time = match[1]; // Время в формате "HH:mm"

    // Проверка наличия аргументов
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
    if (match.input === '/settime') {
        bot.sendMessage(chatId, 'Укажите /settime вместе со временем в формате "HH:mm", например, "/settime 09:00".');
    }
});

// Команда для получения сегодняшнего видео
bot.onText(/\/today/, async () => {
    const data = await getSheetData();
    const rows = data.slice(1);

    if (!data) {
        bot.sendMessage(chatId, 'Данные не получены.');
        return;
    }

    // Получаем сегодняшнюю дату в формате "DD.MM"
    const today = new Date().toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
    }).replace(/\./g, '.');

    // Ищем сегодняшнее видео
    for (const row of rows) {
        const date = row[0]; // Первая колонка — дата
        const url = row[7];  // Восьмая колонка — ссылка

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
    const rows = data.slice(1);

    if (!data) {
        bot.sendMessage(chatId, 'Данные не получены.');
        return;
    }

    // Формируем таблицу в формате Markdown
    let table = '```\n';
    table += '| Дата  | Время |   Направление   |\n';
    table += '|-------|-------|-----------------|\n';

    for (const row of rows) {
        const date = row[0].padEnd(3, ' '); // Фиксируем ширину столбца "Дата"
        const time = row[4].padEnd(5, ' '); // Фиксируем ширину столбца "Время"
        const type = row[5].padEnd(15, ' '); // Фиксируем ширину столбца "Направление"

        table += `| ${date} | ${time} | ${type} |\n`;
    }

    table += '```';

    bot.sendMessage(chatId, table, {parse_mode: 'Markdown'});
});

bot.onText(/\/start/, (msg) => {
    chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Привет! Как тебя зовут?');
    bot.once('message', (msg) => {
        const userName = msg.text;
        userData[chatId] = {userName}; // Сохраняем имя пользователя
        bot.sendMessage(chatId, `Приятно познакомиться, ${userName}! Бот запущен. Используйте /settime HH:mm для настройки времени уведомлений. Время по умолчанию 7:00`);
    });
});

// Команда для помощи
bot.onText(/\/help/, () => {
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

// bot.on('message', (msg) => {
//     if (!msg.text.startsWith('/')) {
//         bot.sendMessage(msg.chat.id, 'Используйте /start для запуска бота или /settime HH:mm для настройки времени уведомлений.');
//     }
// });


