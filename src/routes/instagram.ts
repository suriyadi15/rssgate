import { getUserFeed } from '../platforms/instagram';
import type { Routes } from './types';

export const instagram: Routes = {
    '/user/:user': ({ user }) => getUserFeed(user),
};
