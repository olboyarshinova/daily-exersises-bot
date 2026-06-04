import path from 'node:path';

interface LocalConstants {
  TELEGRAM_BOT_TOKEN?: string;
  GOOGLE_CREDENTIALS?: unknown;
  GOOGLE_SHEETS_ID?: string;
  ADMIN_ID?: number | string;
}

const localConstants = loadLocalConstants();

export const TELEGRAM_BOT_TOKEN = getRequiredValue(
  'TELEGRAM_BOT_TOKEN',
  process.env.TELEGRAM_BOT_TOKEN ?? localConstants.TELEGRAM_BOT_TOKEN,
);

export const GOOGLE_CREDENTIALS = parseGoogleCredentials(
  process.env.GOOGLE_CREDENTIALS ?? localConstants.GOOGLE_CREDENTIALS,
);

export const GOOGLE_SHEETS_ID = getRequiredValue(
  'GOOGLE_SHEETS_ID',
  process.env.GOOGLE_SHEETS_ID ?? localConstants.GOOGLE_SHEETS_ID,
);

export const ADMIN_ID = Number(
  getRequiredValue('ADMIN_ID', process.env.ADMIN_ID ?? localConstants.ADMIN_ID),
);

if (Number.isNaN(ADMIN_ID)) {
  throw new Error('ADMIN_ID must be a number');
}

function loadLocalConstants(): LocalConstants {
  try {
    // constants.js is intentionally gitignored and kept as a local secret file.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(path.resolve(process.cwd(), 'constants.js')) as LocalConstants;
  } catch {
    return {};
  }
}

function getRequiredValue(name: string, value: unknown): string {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required config value: ${name}`);
  }

  return String(value);
}

function parseGoogleCredentials(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
