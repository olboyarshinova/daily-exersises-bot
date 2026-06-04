import { get, run } from './database';
import type { ChatId } from '../types';

export async function checkIfVideoSentToday(chatId: ChatId, date: string): Promise<boolean> {
  const row = await get<{ exists: 1 }>(
    'SELECT 1 as exists FROM sent_videos WHERE chatId = ? AND date = ?',
    [chatId, date],
  );

  return Boolean(row);
}

export async function markVideoAsSent(chatId: ChatId, date: string): Promise<void> {
  const result = await run(
    'INSERT OR IGNORE INTO sent_videos (chatId, date) VALUES (?, ?)',
    [chatId, date],
  );

  if (result.changes > 0) {
    console.log(`Отмечено отправленное видео для ${chatId}`);
  }
}

export async function resetVideoSentStatus(chatId: ChatId, date: string): Promise<void> {
  await run('DELETE FROM sent_videos WHERE chatId = ? AND date = ?', [chatId, date]);
}
