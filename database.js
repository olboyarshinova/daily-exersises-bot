const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('my-database.db');

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chatId INTEGER UNIQUE,
            username TEXT,
            firstName TEXT,
            lastName TEXT,
            notificationTime TEXT
        )
    `);
});

module.exports = db;
