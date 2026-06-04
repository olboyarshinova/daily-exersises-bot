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

  const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
    polling: {
      autoStart: true,
      interval: 300,
      params: {
        timeout: 30,
      },
    },
  });
  const userStates: UserStates = {};
  const userVideoState: UserVideoStates = {};
  const userTimers: UserTimers = {};

  registerRuntimeErrorHandlers(bot);
  registerShutdownHandlers(bot);
  await setBotCommands(bot);
  registerHandlers(bot, userStates, userVideoState);
  scheduleDailyReport(bot);
  setInterval(() => checkAndSendNotifications(bot, userTimers, userVideoState), 30000);
  await testConnection();

  console.log('Бот запущен');
}

async function setBotCommands(bot: TelegramBot): Promise<void> {
  try {
    await bot.setMyCommands(botCommands);
  } catch (error) {
    console.error('Не удалось установить команды бота:', error);
  }
}

function registerRuntimeErrorHandlers(bot: TelegramBot): void {
  bot.on('polling_error', (error) => {
    console.error('Ошибка Telegram polling:', formatTelegramError(error));
  });

  bot.on('webhook_error', (error) => {
    console.error('Ошибка Telegram webhook:', formatTelegramError(error));
  });
}

type ShutdownSignal = 'SIGINT' | 'SIGTERM';

function registerShutdownHandlers(bot: TelegramBot): void {
  const shutdown = async (signal: ShutdownSignal) => {
    console.log(`Получен ${signal}, останавливаю Telegram polling...`);

    try {
      await bot.stopPolling();
      console.log('Telegram polling остановлен');
    } catch (error) {
      console.error('Не удалось остановить Telegram polling:', error);
    } finally {
      process.exit(0);
    }
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

function formatTelegramError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return JSON.stringify(error);
}

bootstrap().catch((error) => {
  console.error('Ошибка запуска бота:', error);
  process.exitCode = 1;
});
