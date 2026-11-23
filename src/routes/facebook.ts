import { getGroupFeed, getPageFeed, getPhotosFeed, getReelsFeed } from '../platforms/facebook';
import type { Routes } from './types';

export const facebook: Routes = {
    '/page/:id': ({ id }) => getPageFeed(id),
    '/group/:id': ({ id }) => getGroupFeed(id),
    '/photos/:id': ({ id }) => getPhotosFeed(id),
    '/reels/:id': ({ id }) => getReelsFeed(id),
};
