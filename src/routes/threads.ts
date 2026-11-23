import { getPostFeed, getSearchFeed, getUserFeed } from '../platforms/threads';
import type { Routes } from './types';

// Query options: replies (user), serpType = tags | default | recent (search)
export const threads: Routes = {
    '/search/:keyword': ({ keyword }, query) => getSearchFeed(keyword, query.serpType),
    '/:user/post/:id': ({ user, id }) => getPostFeed(user, id),
    '/:user': ({ user }, query) => getUserFeed(user, { replies: ['1', 'true'].includes(query.replies) }),
};
