import assert from 'node:assert/strict';
import { getColumnLetter, getDifficultyStars } from '../src/utils/format';
import { parseNotificationTime, timeToMilliseconds } from '../src/utils/time';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test('timeToMilliseconds parses russian minute labels', () => {
  assert.equal(timeToMilliseconds('15 минут'), 15 * 60 * 1000);
  assert.equal(timeToMilliseconds('3 минуты'), 3 * 60 * 1000);
});

test('timeToMilliseconds parses mm:ss and hh:mm:ss', () => {
  assert.equal(timeToMilliseconds('12:30'), 750000);
  assert.equal(timeToMilliseconds('1:02:03'), 3723000);
});

test('parseNotificationTime normalizes valid time and rejects invalid input', () => {
  assert.equal(parseNotificationTime('9:30'), '09:30');
  assert.equal(parseNotificationTime('23:59'), '23:59');
  assert.equal(parseNotificationTime('24:00'), null);
  assert.equal(parseNotificationTime('09:60'), null);
  assert.equal(parseNotificationTime('wrong'), null);
});

test('getDifficultyStars clamps levels to five stars', () => {
  assert.equal(getDifficultyStars(3), '⭐⭐⭐☆☆');
  assert.equal(getDifficultyStars('7'), '⭐⭐⭐⭐⭐');
  assert.equal(getDifficultyStars(undefined), '☆☆☆☆☆');
});

test('getColumnLetter converts spreadsheet column numbers', () => {
  assert.equal(getColumnLetter(1), 'A');
  assert.equal(getColumnLetter(26), 'Z');
  assert.equal(getColumnLetter(27), 'AA');
  assert.equal(getColumnLetter(52), 'AZ');
});
