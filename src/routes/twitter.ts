import { getHomeFeed, getHomeLatestFeed, getKeywordFeed, getLikesFeed, getListFeed, getMediaFeed, getSpacesFeed, getTrendsFeed, getTweetFeed, getUserFeed } from '../platforms/twitter';
import type { Routes } from './types';

// Query options: includeReplies, includeRts (default true), onlyMedia
const flag = (value: string | undefined, fallback: boolean) => (value === undefined ? fallback : ['1', 'true'].includes(value));
const options = (query: Record<string, string>) => ({ replies: flag(query.includeReplies, false), retweets: flag(query.includeRts, true), onlyMedia: flag(query.onlyMedia, false) });

export const twitter: Routes = {
    '/user/:id': ({ id }, query) => getUserFeed(id, options(query)),
    '/media/:id': ({ id }, query) => getMediaFeed(id, options(query)),
    '/likes/:id': ({ id }, query) => getLikesFeed(id, options(query)),
    '/home': (_, query) => getHomeFeed(options(query)),
    '/home_latest': (_, query) => getHomeLatestFeed(options(query)),
    '/trends': () => getTrendsFeed(),
    '/trends/:woeid': ({ woeid }) => getTrendsFeed(woeid),
    '/spaces/:username': ({ username }) => getSpacesFeed(username),
    '/list/:id': ({ id }, query) => getListFeed(id, options(query)),
    '/keyword/:keyword': ({ keyword }, query) => getKeywordFeed(keyword, options(query)),
    '/tweet/:id/status/:status': ({ id, status }) => getTweetFeed(id, status),
};
