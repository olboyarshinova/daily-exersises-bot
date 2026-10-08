# Telegram Video Notification Bot

This bot is designed to automatically send workout videos according to a schedule and collect feedback from users.

## Key Features

- Automatic video distribution at scheduled times
- Notification schedule management
- Feedback and rating collection
- Error reporting
- Daily analytics

## Technologies

- Node.js + TypeScript
- Telegram Bot API
- Google Sheets API
- SQLite

## Project Structure

- `src/index.ts` - application entry point
- `src/bot` - Telegram handlers
- `src/config` - bot commands and runtime config
- `src/db` - SQLite connection and repositories
- `src/google` - Google Sheets integration
- `src/services` - notification, report, and stats workflows
- `src/utils` - date, time, and formatting helpers

## Scripts

- `nvm use` - switch to the project's Node.js version
- `npm run dev` - run the bot from TypeScript sources
- `npm run build` - compile TypeScript to `dist`
- `npm run lint` - check TypeScript code with ESLint
- `npm run format` - format source files with Prettier
- `npm run test` - run build, lint, and unit tests
- `npm start` - run compiled bot
- `npm run stats` - print user/video stats
