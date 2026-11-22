const units: Record<string, number> = {
    second: 1000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 7 * 86_400_000,
    month: 30 * 86_400_000,
    year: 365 * 86_400_000,
};

/** "3 days ago", "an hour ago", "just now" to a date, undefined when the text is not a relative time. */
export const parseRelativeDate = (text: string, now = Date.now()): Date | undefined => {
    const lower = text.trim().toLowerCase();
    if (/^(just now|now)$/.test(lower)) {
        return new Date(now);
    }
    const match = lower.match(/^(?:streamed |updated )?(an?|\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/);
    if (!match) {
        return undefined;
    }
    const amount = match[1].startsWith('a') ? 1 : Number(match[1]);
    return new Date(now - amount * units[match[2]]);
};

export const parseDate = (value: string | number | undefined | null): Date | undefined => {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    const date = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? undefined : date;
};
