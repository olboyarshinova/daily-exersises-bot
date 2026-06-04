import { printDatabaseStats } from './services/statsService';

printDatabaseStats().catch((error) => {
  console.error('Ошибка при получении статистики:', error);
  process.exitCode = 1;
});
