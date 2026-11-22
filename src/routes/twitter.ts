import { getHomeFeed, getKeywordFeed, getListFeed, getTweetFeed, getUserFeed } from '../platforms/twitter';
import type { Routes } from './types';

// Query options: includeReplies, includeRts (default true), onlyMedia
const flag = (value: string | undefined, fallback: boolean) => (value === undefined ? fallback : ['1', 'true'].includes(value));
const options = (query: Record<string, string>) => ({ replies: flag(query.includeReplies, false), retweets: flag(query.includeRts, true), onlyMedia: flag(query.onlyMedia, false) });

export const twitter: Routes = {
    '/user/:id': ({ id }, query) => getUserFeed(id, options(query)),
    '/home': (_, query) => getHomeFeed(options(query)),
    '/list/:id': ({ id }, query) => getListFeed(id, options(query)),
    '/keyword/:keyword': ({ keyword }, query) => getKeywordFeed(keyword, options(query)),
    '/tweet/:id/status/:status': ({ id, status }) => getTweetFeed(id, status),
};
