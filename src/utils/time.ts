export function timeToMilliseconds(timeStr?: string): number {
  if (!timeStr) {
    return 0;
  }

  const minutesMatch = timeStr.match(/^(\d+)\s*минут[ы]?$/i);

  if (minutesMatch) {
    return (parseInt(minutesMatch[1], 10) || 0) * 60 * 1000;
  }

  const parts = timeStr.split(':');

  if (parts.length === 2) {
    const minutes = parseInt(parts[0], 10) || 0;
    const seconds = parseInt(parts[1], 10) || 0;

    return (minutes * 60 + seconds) * 1000;
  }

  if (parts.length === 3) {
    const hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;
    const seconds = parseInt(parts[2], 10) || 0;

    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }

  console.error('Неверный формат времени:', timeStr);
  return 0;
}

export function parseNotificationTime(text: string): string | null {
  const match = text.match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    return null;
  }

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}
