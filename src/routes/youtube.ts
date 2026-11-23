import { getChannelFeed, getChannelIdByCustomUrl, getChannelIdByHandle, getChartsFeed, getCommunityFeed, getLiveFeed, getPlaylistFeed, getShowsFeed, getSubscriptionsFeed } from '../platforms/youtube';
import type { Routes } from './types';

const isChannelId = (value: string) => /^UC[\w-]{22}$/.test(value);
const channelOf = (handleOrId: string) => (isChannelId(handleOrId) ? handleOrId : getChannelIdByHandle(handleOrId));

export const youtube: Routes = {
    '/channel/:id': ({ id }) => getChannelFeed(id),
    '/user/:handle': async ({ handle }) => getChannelFeed(await getChannelIdByHandle(handle)),
    '/c/:username': async ({ username }) => getChannelFeed(await getChannelIdByCustomUrl(username)),
    '/playlist/:id': ({ id }) => getPlaylistFeed(id),
    '/community/:handle': ({ handle }) => getCommunityFeed(handle),
    '/live/:username': async ({ username }) => getLiveFeed(await channelOf(username)),
    '/shows/:username': async ({ username }) => getShowsFeed(await channelOf(username)),
    '/charts': (_, query) => getChartsFeed(undefined, query.country),
    '/charts/:category': ({ category }, query) => getChartsFeed(category, query.country),
    '/charts/:category/:country': ({ category, country }) => getChartsFeed(category, country),
    '/subscriptions': () => getSubscriptionsFeed(),
};
