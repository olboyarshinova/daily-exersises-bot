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
        const headers = Object.keys(rows[0] || {});
        const headerStr = headers.join('\t');
        const dataStr = rows.map(row =>
            headers.map(h => row[h]).join('\t')
        ).join('\n');

        console.log('Отправленные видео:\n', headerStr + '\n' + dataStr);
    }
});

const today = new Date();
const todayFormatted = `${today.getDate().toString().padStart(2, '0')}.${(today.getMonth() + 1).toString().padStart(2, '0')}`;

db.all(`
    SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN isActive = 1 THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN isActive = 0 THEN 1 ELSE 0 END) as inactive_users,
        (SELECT COUNT(DISTINCT chatId) FROM sent_videos WHERE date = ?) as received_today
    FROM users
`, [todayFormatted], async (err, stats) => {
    if (err) {
        console.error('Ошибка при получении статистики:', err.message);
        return;
    }

    const stat = stats[0];
    const inactiveNotReceived = await new Promise((resolve, reject) => {
        db.all(`
            SELECT u.chatId, u.username, u.firstName, u.lastName
            FROM users u
            WHERE NOT EXISTS (
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
    const inactiveList = inactiveNotReceived.length > 0
        ? inactiveNotReceived.map(u =>
            `${u.firstName}${u.lastName ? ' ' + u.lastName : ''}${u.username ? ' (@' + u.username + ')' : ''}`
        ).join(', ')
        : 'Нет неактивных пользователей без уведомлений';

    console.log(`
Статистика пользователей:
- Всего пользователей: ${stat.total_users}
- Активных: ${stat.active_users}
- Неактивных: ${stat.inactive_users}
- Получили уведомление сегодня (${todayFormatted}): ${stat.received_today}
- Неактивные без уведомлений (${inactiveNotReceived.length}): ${inactiveList}
    `);
});

db.close();
