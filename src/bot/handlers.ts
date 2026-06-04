import type TelegramBot from 'node-telegram-bot-api';
import { deactivateUser, findUserByChatId, upsertUser } from '../db/userRepository';
import { resetVideoSentStatus } from '../db/sentVideosRepository';
import {
  getCurrentComment,
  saveCommentToSheet,
} from '../google/sheetsService';
import {
  forwardMediaToAdmin,
  persistErrorReport,
} from '../services/reportService';
import {
  saveNotificationTime,
  sendTodayVideo,
  sendVideoList,
} from '../services/videoService';
import { getTodayDayMonth } from '../utils/date';
import { parseNotificationTime } from '../utils/time';
import type { BotMessage, ChatId, UserStates, UserVideoStates } from '../types';

export function registerHandlers(
  bot: TelegramBot,
  userStates: UserStates,
  userVideoState: UserVideoStates,
): void {
  bot.onText(/\/settime$/, async (msg) => {
    const chatId = msg.chat.id;

    await bot.sendMessage(chatId, 'Выберите время уведомлений (московское время):', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '07:00', callback_data: 'settime_07:00' }],
          [{ text: '08:00', callback_data: 'settime_08:00' }],
          [{ text: '09:00', callback_data: 'settime_09:00' }],
          [{ text: '12:00', callback_data: 'settime_12:00' }],
          [{ text: '15:00', callback_data: 'settime_15:00' }],
          [{ text: '18:00', callback_data: 'settime_18:00' }],
          [{ text: 'Другое время...', callback_data: 'settime_custom' }],
        ],
      },
    });
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    const data = query.data;

    if (!chatId || !messageId || !data) {
      return;
    }

    try {
      if (data === 'skip_rating') {
        await bot.answerCallbackQuery(query.id);
        await bot.editMessageText(
          'Хорошо! Если передумаете - оцените тренировку позже по команде /comment',
          { chat_id: chatId, message_id: messageId },
        );
        return;
      }

      if (data === 'skip_comment') {
        await bot.answerCallbackQuery(query.id);
        await bot.editMessageText(
          'Спасибо за вашу оценку! Если передумаете - добавьте комментарий позже по команде /comment',
          { chat_id: chatId, message_id: messageId },
        );
        delete userStates[chatId];
        return;
      }

      if (data.startsWith('settime_')) {
        await handleSetTimeCallback(bot, query.id, chatId, messageId, data, userStates);
        return;
      }

      if (data.startsWith('rate_')) {
        await handleRatingCallback(bot, query.id, chatId, messageId, data, query.from.first_name, userStates, userVideoState);
        return;
      }

      if (data === 'report_cancel') {
        clearTimeout(userStates[chatId]?.timeout);
        delete userStates[chatId];
        await bot.answerCallbackQuery(query.id);
        await bot.editMessageText('Отправка отчета отменена', {
          chat_id: chatId,
          message_id: messageId,
        });
        return;
      }

      if (data === 'report_example') {
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(
          chatId,
          'Пример хорошего отчета:\n\n' +
            '• Проблема: при нажатии на /today бот не отвечает\n' +
            '• Время: 15:30 20.05.2023\n' +
            '• Действия: открыл бота → нажал /today → ничего не произошло\n',
        );
      }
    } catch (error) {
      console.error('Ошибка обработки callback:', error, chatId);
      await bot.answerCallbackQuery(query.id, {
        text: 'Произошла ошибка, попробуйте позже',
      });
    }
  });

  bot.on('text', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    if (!text || text === '/start') {
      return;
    }

    if (userStates[chatId]?.waitingForTimeInput) {
      await handleManualTimeInput(bot, chatId, text, userStates);
    }
  });

  bot.onText(/\/today/, (msg) => sendTodayVideo(bot, msg.chat.id));
  bot.onText(/\/list/, (msg) => sendVideoList(bot, msg.chat.id));
  bot.onText(/\/start/, (msg) => handleStart(bot, msg));
  bot.onText(/\/mytime/, (msg) => handleMyTime(bot, msg.chat.id));
  bot.onText(/\/comment/, (msg) => handleComment(bot, msg, userVideoState));
  bot.onText(/\/report/, (msg) => handleReport(bot, msg.chat.id, userStates));

  bot.on('message', async (msg) => {
    await handleStateMessage(bot, msg, userStates, userVideoState);
  });

  bot.on('photo', async (msg) => handleReportMedia(bot, msg, userStates));
  bot.on('document', async (msg) => handleReportMedia(bot, msg, userStates));
}

async function handleSetTimeCallback(
  bot: TelegramBot,
  callbackQueryId: string,
  chatId: ChatId,
  messageId: number,
  data: string,
  userStates: UserStates,
): Promise<void> {
  const time = data.split('_')[1];

  if (time === 'custom') {
    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      { chat_id: chatId, message_id: messageId },
    );
    await bot.sendMessage(chatId, 'Введите время вручную в формате HH:mm (например 9:30).');
    await bot.answerCallbackQuery(callbackQueryId);
    userStates[chatId] = { waitingForTimeInput: true };
    return;
  }

  await bot.editMessageReplyMarkup(
    { inline_keyboard: [] },
    { chat_id: chatId, message_id: messageId },
  );
  await bot.answerCallbackQuery(callbackQueryId);
  await saveNotificationTime(bot, chatId, time);
}

async function handleRatingCallback(
  bot: TelegramBot,
  callbackQueryId: string,
  chatId: ChatId,
  messageId: number,
  data: string,
  firstName: string | undefined,
  userStates: UserStates,
  userVideoState: UserVideoStates,
): Promise<void> {
  const rating = parseInt(data.split('_')[1], 10);

  await bot.editMessageReplyMarkup(
    { inline_keyboard: [] },
    { chat_id: chatId, message_id: messageId },
  );
  await bot.answerCallbackQuery(callbackQueryId, {
    text: `Спасибо за оценку ${'⭐'.repeat(rating)}!`,
  });
  await saveCommentToSheet(chatId, firstName || 'User', `${rating}`, userVideoState[chatId]?.date);
  await bot.sendMessage(
    chatId,
    rating < 3
      ? 'Спасибо за оценку! Что необходимо улучшить?'
      : `Спасибо за оценку!

Хотите добавить комментарий к оценке?

Напишите пару слов о тренировке:
• "Понравилось упражнение на пресс"
• "Хочу больше растяжки"
• "Было сложно, но круто!"`,
    {
      reply_markup: {
        inline_keyboard: [[{ text: 'Пропустить', callback_data: 'skip_comment' }]],
      },
    },
  );
  userStates[chatId] = {
    type: 'feedback',
    waitingForComment: true,
    rating,
  };
  userStates[chatId].timeout = setTimeout(() => {
    if (userStates[chatId]?.waitingForComment) {
      delete userStates[chatId];
      bot.sendMessage(chatId, 'Если захотите оставить комментарий позже - используйте команду /comment');
    }
  }, 300000);
}

async function handleManualTimeInput(
  bot: TelegramBot,
  chatId: ChatId,
  text: string,
  userStates: UserStates,
): Promise<void> {
  const formattedTime = parseNotificationTime(text);

  if (!formattedTime) {
    await bot.sendMessage(chatId, `⚠️ Неверный формат времени. Пожалуйста, введите время в формате HH:mm (например, 9:30 или 07:45)

Вы можете уведомить об ошибке по команде /report`);
    return;
  }

  await saveNotificationTime(bot, chatId, formattedTime);
  delete userStates[chatId];
}

async function handleStart(bot: TelegramBot, msg: BotMessage): Promise<void> {
  const chatId = msg.chat.id;
  const username = msg.from?.username ?? null;
  const firstName = msg.from?.first_name ?? null;
  const lastName = msg.from?.last_name ?? null;

  try {
    const previousUser = await findUserByChatId(chatId);
    const notificationTime = previousUser?.notificationTime || '08:00';

    await upsertUser(
      {
        chatId,
        username,
        firstName,
        lastName,
        isActive: 1,
      },
      notificationTime,
    );
    await resetVideoSentStatus(chatId, getTodayDayMonth());
    console.log(`Пользователь ${username} добавлен в базу данных`);
    await bot.sendMessage(
      chatId,
      `Привет, ${firstName}! Добро пожаловать! Используйте /settime для настройки времени уведомлений. Текущее время уведомлений: ${notificationTime} (московское время).`,
    );
  } catch (error) {
    console.error('Ошибка при сохранении данных:', error);
    await bot.sendMessage(chatId, `⚠️ Произошла ошибка при сохранении ваших данных.

Вы можете уведомить об ошибке по команде /report`);
  }
}

async function handleMyTime(bot: TelegramBot, chatId: ChatId): Promise<void> {
  try {
    const user = await findUserByChatId(chatId);

    if (user) {
      await bot.sendMessage(chatId, `Время уведомлений: ${user.notificationTime || '08:00'}`);
    } else {
      await bot.sendMessage(chatId, `⚠️ Нет установленного времени.

Вы можете уведомить об ошибке по команде /report`);
    }
  } catch (error) {
    console.error('Ошибка при получении данных:', error);
  }
}

async function handleComment(
  bot: TelegramBot,
  msg: BotMessage,
  userVideoState: UserVideoStates,
): Promise<void> {
  const chatId = msg.chat.id;

  try {
    await bot.sendMessage(chatId, 'Пожалуйста, напишите ваш комментарий к видео:');
    const response = await waitForUserComment(bot, chatId, 600000);

    if (userVideoState[chatId]) {
      if (response?.text) {
        await saveCommentToSheet(
          response.from?.id || chatId,
          response.from?.first_name || '',
          response.text,
          userVideoState[chatId]?.date,
        );
        await bot.sendMessage(chatId, 'Спасибо за ваш комментарий!');
        delete userVideoState[chatId];
      }
    } else {
      console.error('Комментарий уже был сохранен для ', chatId);
      await bot.sendMessage(chatId, 'Комментарий уже был сохранен.');
    }
  } catch (error) {
    console.error('Ошибка при обработке комментария:', error);
    await bot.sendMessage(chatId, `⚠️ Произошла ошибка при сохранении комментария.

Вы можете уведомить об ошибке по команде /report`);
  }
}

function waitForUserComment(
  bot: TelegramBot,
  chatId: ChatId,
  timeout: number,
): Promise<BotMessage | null> {
  return new Promise((resolve) => {
    const listener = async (msg: BotMessage) => {
      if (msg.chat.id === chatId && msg.text && !msg.text.startsWith('/')) {
        cleanup();
        resolve(msg);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeout);
    const cleanup = () => {
      bot.removeListener('message', listener);
      clearTimeout(timer);
    };

    bot.on('message', listener);
  });
}

async function handleReport(bot: TelegramBot, chatId: ChatId, userStates: UserStates): Promise<void> {
  await bot.sendMessage(
    chatId,
    `🛠 Сообщить об ошибке.

Опишите проблему как можно подробнее:
• Что произошло
• Когда возникла ошибка
• Какие действия к ней привели`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Пример отчета', callback_data: 'report_example' }],
          [{ text: 'Отменить', callback_data: 'report_cancel' }],
        ],
      },
    },
  );
  userStates[chatId] = {
    waitingForErrorReport: true,
    timeout: setTimeout(async () => {
      if (userStates[chatId]?.waitingForErrorReport) {
        await bot.sendMessage(chatId, 'Время на отправку отчета истекло. Используйте /report когда будете готовы.');
        delete userStates[chatId];
      }
    }, 300000),
  };
}

async function handleStateMessage(
  bot: TelegramBot,
  msg: BotMessage,
  userStates: UserStates,
  userVideoState: UserVideoStates,
): Promise<void> {
  if (!msg.text || msg.text.startsWith('/')) {
    return;
  }

  const chatId = msg.chat.id;
  const userState = userStates[chatId];

  try {
    if (userState?.waitingForComment) {
      await saveFeedbackComment(bot, msg, userState.rating || 0, userStates, userVideoState);
    }

    if (userState?.waitingForErrorReport) {
      const reportData = {
        userId: chatId,
        userName: msg.from?.first_name || 'Аноним',
        text: msg.text,
        date: new Date(),
        hasMedia: userState.hasMedia || false,
      };

      await persistErrorReport(bot, reportData);

      if (userState.hasMedia && userState.mediaFileId && userState.mediaType) {
        await forwardMediaToAdmin(bot, userState.mediaFileId, userState.mediaType, msg.text);
      }

      await bot.sendMessage(chatId, 'Отчет об ошибке успешно отправлен. Спасибо!');
      clearTimeout(userState.timeout);
      delete userStates[chatId];
    }
  } catch (error) {
    const maybeTelegramError = error as { response?: { statusCode?: number } };

    if (maybeTelegramError.response?.statusCode === 403) {
      await deactivateUser(chatId);
    }
  }
}

async function saveFeedbackComment(
  bot: TelegramBot,
  msg: BotMessage,
  rating: number,
  userStates: UserStates,
  userVideoState: UserVideoStates,
): Promise<void> {
  const chatId = msg.chat.id;
  const userState = userStates[chatId];

  try {
    const currentComment = await getCurrentComment(
      chatId,
      msg.from?.first_name || 'User',
      userVideoState[chatId]?.date,
    );
    const updatedComment = currentComment.includes('Оценка:')
      ? `${currentComment}, ${msg.text}`
      : `${rating}, ${msg.text}`;

    await saveCommentToSheet(
      chatId,
      msg.from?.first_name || 'User',
      updatedComment,
      userVideoState[chatId]?.date,
    );
    delete userStates[chatId];
    await bot.sendMessage(chatId, 'Ваш отзыв сохранен! Спасибо!');
    clearTimeout(userState?.timeout);
  } catch (error) {
    console.error('Ошибка сохранения отзыва:', error);
    await bot.sendMessage(chatId, `⚠️ Не удалось отправить отзыв. Попробуйте позже.

Вы можете уведомить об ошибке по команде /report`);
  }
}

async function handleReportMedia(
  bot: TelegramBot,
  msg: BotMessage,
  userStates: UserStates,
): Promise<void> {
  const chatId = msg.chat.id;
  const state = userStates[chatId];

  if (!state?.waitingForErrorReport) {
    return;
  }

  try {
    const fileData = extractAllowedFile(msg);

    if (!fileData) {
      await bot.sendMessage(msg.chat.id, '⚠️ Поддерживаются только JPG, PNG и PDF');
      return;
    }

    if (fileData.fileSize && fileData.fileSize > 5 * 1024 * 1024) {
      await bot.sendMessage(msg.chat.id, '⚠️ Файл слишком большой (макс. 5MB)');
      return;
    }

    userStates[chatId] = {
      ...state,
      hasMedia: true,
      mediaFileId: fileData.fileId,
      mediaType: fileData.mediaType,
    };
    await bot.sendMessage(chatId, '📎 Медиафайл получен! Теперь, пожалуйста, опишите проблему текстом:', {
      reply_markup: {
        inline_keyboard: [[{ text: 'Отменить отправку', callback_data: 'report_cancel' }]],
      },
    });
  } catch (error) {
    console.error('Ошибка обработки медиафайла:', error);
    await bot.sendMessage(chatId, `⚠️ Не удалось обработать файл. Попробуйте отправить его еще раз.

Вы можете уведомить об ошибке по команде /report`);
  }
}

function extractAllowedFile(
  msg: BotMessage,
): { fileId: string; fileSize?: number; mediaType: 'photo' | 'document' } | null {
  if (msg.photo?.length) {
    const photo = msg.photo[msg.photo.length - 1];
    return {
      fileId: photo.file_id,
      fileSize: photo.file_size,
      mediaType: 'photo',
    };
  }

  if (!msg.document) {
    return null;
  }

  const allowedFileTypes = ['image/jpeg', 'image/png', 'application/pdf'];

  if (!msg.document.mime_type || !allowedFileTypes.includes(msg.document.mime_type)) {
    return null;
  }

  return {
    fileId: msg.document.file_id,
    fileSize: msg.document.file_size,
    mediaType: 'document',
  };
}
