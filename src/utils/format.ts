export function getDifficultyStars(level: string | number | undefined): string {
  const maxLevel = 5;
  const parsedLevel = Number(level) || 0;
  const safeLevel = Math.max(0, Math.min(maxLevel, parsedLevel));

  return '⭐'.repeat(safeLevel) + '☆'.repeat(maxLevel - safeLevel);
}

export function getColumnLetter(columnIndex: number): string {
  let letter = '';

  while (columnIndex > 0) {
    const remainder = (columnIndex - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    columnIndex = Math.floor((columnIndex - 1) / 26);
  }

  return letter || 'A';
}
