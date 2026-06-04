export function getTodayDayMonth(): string {
  return new Date()
    .toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
    })
    .replace(/\./g, '.');
}

export function getCurrentTimeHHMM(): string {
  const now = new Date();

  return `${now.getHours().toString().padStart(2, '0')}:${now
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}
