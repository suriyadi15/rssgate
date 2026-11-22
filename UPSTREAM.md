# Upstream map

Code here is a rewrite of the scraping logic of [DIYgod/RSSHub](https://github.com/DIYgod/RSSHub). Nothing is merged from it; fixes and new routes are adopted by hand.

`scripts/check-upstream.sh` lists the RSSHub commits that touched the files below since the commit recorded in the last column.
Adopt what matters, then move the commit forward in this table.

| rssgate file                    | RSSHub files (under `lib/routes/`)                                                                                                                                  | adopted up to |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `src/platforms/youtube.ts`      | `youtube/api/youtubei.ts`, `youtube/channel.ts`, `youtube/user.ts`, `youtube/playlist.ts`, `youtube/community.tsx`                                                  | ba5c50462b    |
| `src/platforms/threads.ts`      | `threads/utils.ts`, `threads/index.ts`                                                                                                                              | ba5c50462b    |
| `src/platforms/tiktok.ts`       | `tiktok/user.ts`, `juejin/utils.ts` (WAF solver)                                                                                                                    | ba5c50462b    |
| `src/platforms/instagram.ts`    | `instagram/index.ts`, `instagram/web-api/utils.ts`, `instagram/templates/render.ts`                                                                                 | ba5c50462b    |
| `src/platforms/facebook.ts`     | `facebook/page.ts`, `facebook/utils.ts`                                                                                                                             | ba5c50462b    |
| `src/platforms/twitter.ts`      | `twitter/api/web-api/*.ts`, `twitter/utils.ts`, `twitter/user.ts`, `twitter/home.ts`, `twitter/list.ts`, `twitter/keyword.ts`, `twitter/tweet.ts`                   | ba5c50462b    |

Things that break most often upstream and are worth checking first: Instagram `docIds`, Facebook `doc_id`s, Twitter query ids (fetched live, fallbacks in `fallbackIds`) and features, Threads page shape.
