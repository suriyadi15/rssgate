import { getHighlightsFeed, getStoriesFeed, getTagsFeed, getUserFeed } from '../platforms/instagram';
import type { Routes } from './types';

export const instagram: Routes = {
    '/user/:user': ({ user }) => getUserFeed(user),
    '/stories/:user': ({ user }) => getStoriesFeed(user),
    '/highlights/:user': ({ user }) => getHighlightsFeed(user),
    '/tags/:tag': ({ tag }) => getTagsFeed(tag),
};
