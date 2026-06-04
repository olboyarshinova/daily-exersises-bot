import type TelegramBot from 'node-telegram-bot-api';

export const botCommands: TelegramBot.BotCommand[] = [
  { command: '/start', description: '♻️  Обновить бота' },
  { command: '/settime', description: '🕗  Установить время уведомлений' },
  { command: '/today', description: '🎥  Получить сегодняшнее видео' },
  { command: '/list', description: '📋  Список всех видео' },
  { command: '/mytime', description: '⏰  Установленное время уведомлений' },
  { command: '/report', description: '🚨  Уведомить об ошибке' },
];
