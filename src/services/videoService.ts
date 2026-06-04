import type TelegramBot from 'node-telegram-bot-api';
import {
  getNotificationRecipients,
  updateNotificationTime,
} from '../db/userRepository';
import {
  checkIfVideoSentToday,
  markVideoAsSent,
} from '../db/sentVideosRepository';
import {
  getSheetData,
  getTodayVideo,
  type WorkoutVideo,
} from '../google/sheetsService';
import { getCurrentTimeHHMM, getTodayDayMonth } from '../utils/date';
import { getDifficultyStars } from '../utils/format';
import { timeToMilliseconds } from '../utils/time';
import type { ChatId, UserTimers, UserVideoStates } from '../types';

export async function checkAndSendNotifications(
  bot: TelegramBot,
  userTimers: UserTimers,
  userVideoState: UserVideoStates,
): Promise<void> {
  try {
    console.log('Запуск проверки уведомлений...');
    const currentTime = getCurrentTimeHHMM();
    const todayVideo = await getTodayVideo();

    if (!todayVideo) {
      console.log('На сегодня видео не найдено');
      return;
    }

    const recipients = await getNotificationRecipients(currentTime);

    console.log(`Найдено ${recipients.length} пользователей для уведомления в ${currentTime}`);
    await Promise.all(
      recipients.map((row) => sendVideoNotification(bot, row.chatId, todayVideo, userTimers, userVideoState)),
    );
  } catch (error) {
    console.error('Ошибка в checkAndSendNotifications:', error);
  }
}

export async function sendVideoNotification(
  bot: TelegramBot,
  chatId: ChatId,
  video: WorkoutVideo,
  userTimers: UserTimers,
  userVideoState: UserVideoStates,
): Promise<void> {
  try {
    if (!video.url) {
      console.log('Видео на сегодня не найдено');
      return;
    }

    if (await checkIfVideoSentToday(chatId, video.date)) {
      console.log(`Видео уже отправлено ${chatId} сегодня`);
      return;
    }

    await bot.sendMessage(chatId, formatVideoMessage(video));
    await markVideoAsSent(chatId, video.date);
    scheduleRatingReminder(bot, chatId, video, userTimers, userVideoState);
  } catch (error) {
    console.error(`Ошибка в sendVideoNotification (${chatId}):`, error);

    try {
      await bot.sendMessage(chatId, `⚠️ Произошла ошибка при отправке видео. Попробуйте позже.

Вы можете уведомить об ошибке по команде /report`);
    } catch (sendError) {
      console.error('Ошибка при отправке сообщения об ошибке:', chatId, sendError);
    }
  }
}

export async function saveNotificationTime(
  bot: TelegramBot,
  chatId: ChatId,
  time: string,
): Promise<void> {
  try {
    const user = await updateNotificationTime(chatId, time);

    if (!user) {
      console.log(`Пользователь ${chatId} не найден`);
      await bot.sendMessage(chatId, 'Сначала запустите бота командой /start.');
      return;
    }

    console.log(`Для пользователя ${chatId} время уведомлений изменено на ${time}.`);
    await bot.sendMessage(chatId, `Теперь уведомления будут приходить в ${time}.`);
  } catch (error) {
    console.error(`Ошибка при сохранении времени для ${chatId}:`, error);
    await bot.sendMessage(chatId, `⚠️ Произошла ошибка при сохранении времени.

Вы можете уведомить об ошибке по команде /report`);
  }
}

export async function sendTodayVideo(bot: TelegramBot, chatId: ChatId): Promise<void> {
  const video = await getTodayVideo();

  if (!video) {
    await bot.sendMessage(chatId, `⚠️ На сегодня видео не найдено.

Вы можете уведомить об ошибке по команде /report`);
    return;
  }

  await bot.sendMessage(chatId, formatVideoMessage(video, true));
}

export async function sendVideoList(bot: TelegramBot, chatId: ChatId): Promise<void> {
  const data = await getSheetData();

  if (!data) {
    await bot.sendMessage(chatId, `⚠️ Данные не получены.

Вы можете уведомить об ошибке по команде /report`);
    return;
  }

  const todayFormatted = getTodayDayMonth();
  let table = '```\n';

  table += '| Дата  | Длит. |   Направление   |\n';
  table += '|-------|-------|-----------------|\n';

  for (const row of data.slice(1)) {
    const date = row[0];
    const time = row[4] || '';
    const type = row[5] || '';

    if (!/^\d{2}\.\d{2}$/.test(date)) {
      console.error(`Некорректный формат даты: ${date}`, chatId);
      continue;
    }

    const [day, month] = date.split('.');
    const [todayDay, todayMonth] = todayFormatted.split('.');
    const rowDateNumber = parseInt(month + day, 10);
    const todayDateNumber = parseInt(todayMonth + todayDay, 10);

    if (rowDateNumber >= todayDateNumber) {
      table += `| ${date.padEnd(5, ' ')} | ${time.padEnd(5, ' ')} | ${type.padEnd(15, ' ')} |\n`;
    }
  }

  table += '```';
  await bot.sendMessage(chatId, table, { parse_mode: 'Markdown' });
}

function scheduleRatingReminder(
  bot: TelegramBot,
  chatId: ChatId,
  video: WorkoutVideo,
  userTimers: UserTimers,
  userVideoState: UserVideoStates,
): void {
  const videoDurationMs = timeToMilliseconds(video.time);

  if (!videoDurationMs || Number.isNaN(videoDurationMs)) {
    console.error('Некорректное время видео');
    return;
  }

  if (userTimers[chatId]) {
    clearTimeout(userTimers[chatId]);
    delete userTimers[chatId];
  }

  userTimers[chatId] = setTimeout(async () => {
    try {
      await bot.sendMessage(
        chatId,
        `Оцените сегодняшнюю тренировку.
Ваша оценка улучшит подбор упражнений!`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '1', callback_data: 'rate_1' },
                { text: '2', callback_data: 'rate_2' },
                { text: '3', callback_data: 'rate_3' },
                { text: '4', callback_data: 'rate_4' },
                { text: '5', callback_data: 'rate_5' },
              ],
              [{ text: 'Пропустить', callback_data: 'skip_rating' }],
            ],
          },
        },
      );

      userVideoState[chatId] = {
        videoUrl: video.url || '',
        date: video.date,
      };
    } catch (error) {
      console.error('Ошибка при отправке напоминания:', error);
    }
  }, videoDurationMs + 60000 * 3);
}

function formatVideoMessage(video: WorkoutVideo, normalizeType = false): string {
  const formattedType =
    normalizeType && video.type
      ? video.type.charAt(0).toLowerCase() + video.type.slice(1)
      : video.type;

  return `Сегодняшнее видео: ${video.url}

Автор: ${video.author || ''}
Длительность: ${video.time || ''}
Направление: ${formattedType || ''}
Сложность: ${getDifficultyStars(video.level)}
ВПН: ${video.url?.includes('youtube') ? 'нужен' : 'не нужен'}
${video.comment ? `Комментарий: ${video.comment}` : ''}`;
}
