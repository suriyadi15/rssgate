import { getLiveFeed, getUserFeed } from '../platforms/tiktok';
import type { Routes } from './types';

export const tiktok: Routes = {
    '/user/:user': ({ user }) => getUserFeed(user),
    '/live/:user': ({ user }) => getLiveFeed(user),
};
