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


db.close();
