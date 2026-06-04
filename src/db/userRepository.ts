import { all, get, run } from './database';
import type { ChatId, DailyStats, NotificationRecipient, ProblemUser, UserRow } from '../types';

export async function findUserByChatId(chatId: ChatId): Promise<UserRow | undefined> {
  return get<UserRow>('SELECT * FROM users WHERE chatId = ?', [chatId]);
}

export async function upsertUser(user: UserRow, notificationTime = '08:00'): Promise<void> {
  await run(
    `
      INSERT OR REPLACE INTO users
      (chatId, username, firstName, lastName, notificationTime, isActive)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      user.chatId,
      user.username ?? null,
      user.firstName ?? null,
      user.lastName ?? null,
      notificationTime,
      user.isActive ?? 1,
    ],
  );
}

export async function updateNotificationTime(
  chatId: ChatId,
  time: string,
): Promise<UserRow | null> {
  const user = await findUserByChatId(chatId);

  if (!user) {
    return null;
  }

  await upsertUser(user, time);

  return { ...user, notificationTime: time };
}

export async function deactivateUser(chatId: ChatId): Promise<void> {
  await run('UPDATE users SET isActive = 0 WHERE chatId = ?', [chatId]);
}

export async function getNotificationRecipients(time: string): Promise<NotificationRecipient[]> {
  return all<NotificationRecipient>(
    `
      SELECT DISTINCT chatId, firstName
      FROM users
      WHERE notificationTime = ?
      AND isActive = 1
    `,
    [time],
  );
}

export async function getDailyStats(todayFormatted: string): Promise<DailyStats> {
  const stats = await get<DailyStats>(
    `
      SELECT
        COUNT(*) as total_users,
        SUM(CASE WHEN isActive = 1 THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN isActive = 0 THEN 1 ELSE 0 END) as inactive_users,
        (SELECT COUNT(DISTINCT chatId) FROM sent_videos WHERE date = ?) as received_today,
        (SELECT COUNT(DISTINCT chatId) FROM sent_videos WHERE date = ?) as actually_received
      FROM users
    `,
    [todayFormatted, todayFormatted],
  );

  return (
    stats ?? {
      total_users: 0,
      active_users: 0,
      inactive_users: 0,
      received_today: 0,
      actually_received: 0,
    }
  );
}

export async function getUsersWithoutVideo(todayFormatted: string): Promise<ProblemUser[]> {
  return all<ProblemUser>(
    `
      SELECT u.chatId, u.username, u.firstName, u.lastName, u.notificationTime
      FROM users u
      WHERE u.isActive = 1
      AND NOT EXISTS (
        SELECT 1 FROM sent_videos sv
        WHERE sv.chatId = u.chatId
        AND sv.date = ?
      )
    `,
    [todayFormatted],
  );
}
