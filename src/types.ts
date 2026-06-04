import type TelegramBot from 'node-telegram-bot-api';

export type ChatId = number;

export interface UserRow {
  id?: number;
  chatId: ChatId;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  notificationTime?: string | null;
  isActive?: number | boolean | null;
}

export interface NotificationRecipient {
  chatId: ChatId;
  firstName?: string | null;
}

export interface DailyStats {
  total_users: number;
  active_users?: number;
  inactive_users?: number;
  actually_received?: number;
  received_today?: number;
}

export interface ProblemUser {
  chatId: ChatId;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  notificationTime?: string | null;
}

export interface UserState {
  waitingForTimeInput?: boolean;
  waitingForComment?: boolean;
  waitingForErrorReport?: boolean;
  type?: 'feedback';
  rating?: number;
  timeout?: NodeJS.Timeout;
  hasMedia?: boolean;
  mediaFileId?: string | null;
  mediaType?: 'photo' | 'document' | null;
}

export interface UserVideoState {
  videoUrl: string;
  date: string;
}

export interface ErrorReportData {
  userId: ChatId;
  userName: string;
  text: string;
  date: Date;
  hasMedia: boolean;
}

export type UserStates = Record<ChatId, UserState>;
export type UserVideoStates = Record<ChatId, UserVideoState | undefined>;
export type UserTimers = Record<ChatId, NodeJS.Timeout | undefined>;

export type BotMessage = TelegramBot.Message;
