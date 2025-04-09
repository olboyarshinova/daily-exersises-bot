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

db.close();
