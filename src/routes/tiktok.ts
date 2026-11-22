import { getUserFeed } from '../platforms/tiktok';
import type { Routes } from './types';

export const tiktok: Routes = {
    '/user/:user': ({ user }) => getUserFeed(user),
};
