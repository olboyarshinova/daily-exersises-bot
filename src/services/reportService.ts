import type TelegramBot from 'node-telegram-bot-api';
import { ADMIN_ID } from '../config/constants';
import { getDailyStats, getUsersWithoutVideo } from '../db/userRepository';
import { saveErrorReport } from '../google/sheetsService';
import { getTodayDayMonth } from '../utils/date';
import type { ErrorReportData } from '../types';

let isReportScheduled = false;

export async function sendDailyReport(bot: TelegramBot): Promise<void> {
  try {
    const todayFormatted = getTodayDayMonth();
    const stats = await getDailyStats(todayFormatted);
    const problems = await getUsersWithoutVideo(todayFormatted);
    const problemsList =
      problems.length > 0
        ? problems.map((user) => `@${user.username || 'нет'} (${user.firstName})`).join(', ')
        : 'Нет проблемных пользователей';
    const report = `
📊 Ежедневный отчет:
- Всего пользователей: ${stats.total_users}
- Фактически получили: ${stats.actually_received ?? 0}
- Проблемные пользователи (${problems.length}): ${problemsList}
- Дата: ${new Date().toLocaleDateString('ru-RU')}
        `;

    await bot.sendMessage(ADMIN_ID, report);
    console.log('Ежедневный отчет отправлен администратору');
  } catch (error) {
    console.error('Ошибка при формировании отчета:', error);
  }
}

export function scheduleDailyReport(bot: TelegramBot): void {
  if (isReportScheduled) {
    return;
  }

  isReportScheduled = true;

  const now = new Date();
  const targetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0);

  if (now > targetTime) {
    targetTime.setDate(targetTime.getDate() + 1);
  }

  const timeUntilReport = targetTime.getTime() - now.getTime();

  setTimeout(async () => {
    await sendDailyReport(bot);
    setInterval(() => sendDailyReport(bot), 24 * 60 * 60 * 1000);
  }, timeUntilReport);

  console.log(`Следующий отчет будет отправлен в ${targetTime.toLocaleTimeString()}`);
}

export async function persistErrorReport(
  bot: TelegramBot,
  reportData: ErrorReportData,
): Promise<void> {
  await saveErrorReport(reportData);
  await bot.sendMessage(
    ADMIN_ID,
    `Пользователь ${reportData.userName} отправил отчет об ошибке:
${reportData.text}`,
  );
}

export async function forwardMediaToAdmin(
  bot: TelegramBot,
  fileId: string,
  mediaType: 'photo' | 'document',
  caption: string,
): Promise<void> {
  try {
    if (mediaType === 'photo') {
      await bot.sendPhoto(ADMIN_ID, fileId, { caption: `Ошибка: ${caption}` });
    } else {
      await bot.sendDocument(ADMIN_ID, fileId, { caption: `Ошибка: ${caption}` });
    }
  } catch (error) {
    console.error('Ошибка пересылки медиа:', error);
  }
}
