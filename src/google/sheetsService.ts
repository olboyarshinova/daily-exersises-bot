import { google, sheets_v4 } from 'googleapis';
import { GOOGLE_CREDENTIALS, GOOGLE_SHEETS_ID } from '../config/constants';
import { getColumnLetter } from '../utils/format';
import { getTodayDayMonth } from '../utils/date';
import type { ChatId, ErrorReportData } from '../types';

type GoogleAuthOptions = NonNullable<ConstructorParameters<typeof google.auth.GoogleAuth>[0]>;

const auth = new google.auth.GoogleAuth({
  credentials: GOOGLE_CREDENTIALS as GoogleAuthOptions['credentials'],
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const sheetName = 'Зарядки';

export interface WorkoutVideo {
  date: string;
  author?: string;
  time?: string;
  type?: string;
  level?: string;
  url?: string;
  comment?: string;
}

export async function getSheetData(): Promise<string[][] | null> {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: `${sheetName}!A:Z`,
    });

    if (!response.data.values || response.data.values.length === 0) {
      console.log('Таблица пуста или данные отсутствуют.');
      return null;
    }

    return response.data.values as string[][];
  } catch (error) {
    console.error('Ошибка при получении данных из Google Sheets:', error);
    return null;
  }
}

export async function getTodayVideo(): Promise<WorkoutVideo | null> {
  const data = await getSheetData();

  if (!data) {
    return null;
  }

  return mapRowToVideo(data.find((row) => row[0] === getTodayDayMonth()));
}

export async function saveCommentToSheet(
  userId: ChatId,
  userName: string,
  comment: string,
  date?: string,
): Promise<boolean> {
  try {
    const todayFormatted = date || getTodayDayMonth();
    const firstName = (userName || 'User').split(' ')[0];
    const columnTitle = `Отзыв ${firstName} (${userId})`;
    const rows = await getRows(`${sheetName}!A:Z`);
    let todayRowNum = rows.findIndex((row) => row[0] === todayFormatted) + 1;

    if (todayRowNum === 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: GOOGLE_SHEETS_ID,
        range: `${sheetName}!A:A`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[todayFormatted]] },
      });
      todayRowNum = rows.length + 1;
    }

    const userColumnLetter = await resolveUserColumn(rows, columnTitle);
    const range = `${sheetName}!${userColumnLetter}${todayRowNum}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[comment]] },
    });

    console.log(`Комментарий сохранен в ${range}`);

    return true;
  } catch (error) {
    console.error('Ошибка сохранения в Google Sheets:', error, userId);
    throw new Error('Не удалось сохранить комментарий');
  }
}

export async function getCurrentComment(
  chatId: ChatId,
  userName: string,
  date?: string,
): Promise<string> {
  try {
    const todayFormatted = date || getTodayDayMonth();
    const firstName = (userName || 'User').split(' ')[0];
    const columnTitle = `Отзыв ${firstName} (${chatId})`;
    const rows = await getRows(`${sheetName}!A:Z`);
    const todayRowIndex = rows.findIndex((row) => row[0] === todayFormatted);

    if (todayRowIndex === -1) {
      return '';
    }

    const userColumnIndex = (rows[0] || []).findIndex((cell) => cell === columnTitle);

    if (userColumnIndex === -1) {
      return '';
    }

    return rows[todayRowIndex][userColumnIndex] || '';
  } catch (error) {
    console.error('Ошибка при получении комментария:', error);
    return '';
  }
}

export async function saveErrorReport(data: ErrorReportData): Promise<void> {
  const timestamp = data.date.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

  await sheets.spreadsheets.values.append({
    spreadsheetId: GOOGLE_SHEETS_ID,
    range: 'Ошибки!A:E',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[timestamp, data.userId, data.userName, data.text, data.hasMedia ? 'Да' : 'Нет']],
    },
  });
}

export async function testConnection(): Promise<boolean> {
  try {
    console.log('Тестирование соединения с Google Sheets...');
    await sheets.spreadsheets.get({
      spreadsheetId: GOOGLE_SHEETS_ID,
    });
    console.log('✅ Соединение успешно!');

    return true;
  } catch (error) {
    const typedError = error as { message?: string; code?: string | number };
    console.error('❌ Ошибка соединения:', typedError.message);
    console.log('Код ошибки:', typedError.code);

    return false;
  }
}

async function getRows(range: string): Promise<string[][]> {
  const response: sheets_v4.Schema$ValueRange = (
    await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range,
    })
  ).data;

  return (response.values || []) as string[][];
}

async function resolveUserColumn(rows: string[][], columnTitle: string): Promise<string> {
  let userColumnLetter = 'B';

  if (rows[0]) {
    for (let i = 1; i < rows[0].length; i += 1) {
      if (rows[0][i] === columnTitle) {
        return getColumnLetter(i + 1);
      }
    }
  }

  if (rows[0]?.length > 1) {
    userColumnLetter = getColumnLetter(rows[0].length + 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: `${sheetName}!${userColumnLetter}1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[columnTitle]] },
    });
  }

  return userColumnLetter;
}

function mapRowToVideo(row?: string[]): WorkoutVideo | null {
  if (!row) {
    return null;
  }

  const [date, , , author, time, type, level, url, comment] = row;

  return {
    date,
    author,
    time,
    type,
    level,
    url,
    comment,
  };
}
