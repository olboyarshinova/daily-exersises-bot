import { closeDatabase, initializeDatabase } from '../db/database';
import { getDailyStats, getUsersWithoutVideo } from '../db/userRepository';
import { getTodayDayMonth } from '../utils/date';

export async function printDatabaseStats(): Promise<void> {
  await initializeDatabase();

  const todayFormatted = getTodayDayMonth();
  const stats = await getDailyStats(todayFormatted);
  const usersWithoutVideo = await getUsersWithoutVideo(todayFormatted);
  const inactiveList =
    usersWithoutVideo.length > 0
      ? usersWithoutVideo
          .map(
            (user) =>
              `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}${
                user.username ? ` (@${user.username})` : ''
              }`,
          )
          .join(', ')
      : 'Нет неактивных пользователей без уведомлений';

  console.log(`
Статистика пользователей:
- Всего пользователей: ${stats.total_users}
- Активных: ${stats.active_users ?? 0}
- Неактивных: ${stats.inactive_users ?? 0}
- Получили уведомление сегодня (${todayFormatted}): ${stats.received_today ?? 0}
- Неактивные без уведомлений (${usersWithoutVideo.length}): ${inactiveList}
  `);

  await closeDatabase();
}
