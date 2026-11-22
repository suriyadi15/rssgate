import { getChannelFeed, getChannelIdByHandle, getCommunityFeed, getPlaylistFeed } from '../platforms/youtube';
import type { Routes } from './types';

export const youtube: Routes = {
    '/channel/:id': ({ id }) => getChannelFeed(id),
    '/user/:handle': async ({ handle }) => getChannelFeed(await getChannelIdByHandle(handle)),
    '/playlist/:id': ({ id }) => getPlaylistFeed(id),
    '/community/:handle': ({ handle }) => getCommunityFeed(handle),
};
