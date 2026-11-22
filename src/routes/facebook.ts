import { getPageFeed } from '../platforms/facebook';
import type { Routes } from './types';

export const facebook: Routes = {
    '/page/:id': ({ id }) => getPageFeed(id),
};
