import { getUserFeed } from '../platforms/threads';
import type { Routes } from './types';

export const threads: Routes = {
    '/:user': ({ user }) => getUserFeed(user),
};
