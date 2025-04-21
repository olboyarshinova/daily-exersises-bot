const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('my-database.db');

db.serialize(() => {
    db.serialize(() => {
        db.run(`
           ALTER TABLE users ADD COLUMN isActive BOOLEAN DEFAULT 1
        `, (err) => {
            if (err) {
                if (!err.message.includes('duplicate column name')) {
                    console.error('Ошибка при добавлении столбца isActive:', err);
                }
            } else {
                console.log('Столбец isActive успешно добавлен');
            }
        });

        db.run(`UPDATE users SET isActive = 1 WHERE isActive IS NULL`);

        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chatId INTEGER UNIQUE,
                username TEXT,
                firstName TEXT,
                lastName TEXT,
                notificationTime TEXT DEFAULT '07:00',
                isActive BOOLEAN DEFAULT 1
               )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS sent_videos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chatId INTEGER,
                date TEXT,
                UNIQUE(chatId, date) ON CONFLICT REPLACE
               )
        `);
    });
});

module.exports = db;
