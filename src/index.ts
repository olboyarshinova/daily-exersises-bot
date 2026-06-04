import TelegramBot from 'node-telegram-bot-api';
import { botCommands } from './config/botCommands';
import { TELEGRAM_BOT_TOKEN } from './config/constants';
import { initializeDatabase } from './db/database';
import { registerHandlers } from './bot/handlers';
import { testConnection } from './google/sheetsService';
import { scheduleDailyReport } from './services/reportService';
import { checkAndSendNotifications } from './services/videoService';
import type { UserStates, UserTimers, UserVideoStates } from './types';

async function bootstrap(): Promise<void> {
  await initializeDatabase();

  const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
  const userStates: UserStates = {};
  const userVideoState: UserVideoStates = {};
  const userTimers: UserTimers = {};

  await bot.setMyCommands(botCommands);
  registerHandlers(bot, userStates, userVideoState);
  scheduleDailyReport(bot);
  setInterval(() => checkAndSendNotifications(bot, userTimers, userVideoState), 30000);
  await testConnection();

  console.log('Бот запущен');
}

bootstrap().catch((error) => {
  console.error('Ошибка запуска бота:', error);
  process.exitCode = 1;
});
