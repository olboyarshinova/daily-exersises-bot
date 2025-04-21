const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('my-database.db');

db.all('SELECT * FROM users', (err, rows) => {
    if (err) {
        console.error(err.message);
    } else {
        console.log('Данные из таблицы users:');
        rows.forEach((row) => {
            console.log(row);
        });
    }
});

db.all('SELECT * FROM sent_videos', (err, rows) => {
    if (err) {
        console.error(err.message);
    } else {
        console.log('Данные из таблицы sent_videos:');
        rows.forEach((row) => {
            console.log(row);
        });
    }
});

db.all(`
    SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN isActive = 1 THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN isActive = 0 THEN 1 ELSE 0 END) as inactive_users,
        (SELECT COUNT(DISTINCT chatId) FROM sent_videos 
        WHERE date = date('now')) as received_today
        FROM users
    `, (err, stats) => {
    if (err) {
        console.error('Ошибка при получении статистики:', err.message);
    } else {
        const stat = stats[0];
        console.log(`
Статистика пользователей:
- Всего пользователей: ${stat.total_users}
- Активных: ${stat.active_users}
- Неактивных: ${stat.inactive_users}
- Получили уведомление сегодня: ${stat.received_today}
        `);
    }
});

// Дополнительный запрос для анализа расхождения
db.all(`
    SELECT 
        u.chatId,
        u.username,
        u.firstName,
        u.isActive,
        (SELECT COUNT(*) FROM sent_videos sv 
        WHERE sv.chatId = u.chatId AND sv.date = date('now')) as received_today
        FROM users u
        WHERE u.isActive = 1
    `, (err, activeUsers) => {
    if (err) {
        console.error('Ошибка при анализе активных пользователей:', err.message);
    } else {
        const notReceived = activeUsers.filter(u => !u.received_today);
        console.log(`Активные пользователи, не получившие уведомление сегодня (${notReceived.length}):`);
        notReceived.forEach(user => {
            console.log(`- ${user.firstName} (@${user.username}) [${user.chatId}]`);
        });
    }
});

db.close();
