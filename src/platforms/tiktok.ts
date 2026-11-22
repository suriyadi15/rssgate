// Ported from RSSHub lib/routes/tiktok/user.ts and the WAF solver of lib/routes/juejin/utils.ts
import { createHash } from 'node:crypto';

import { load } from 'cheerio';

import { tryGet } from '../cache';
import { badRequest, HttpError } from '../errors';
import type { Feed } from '../feed';
import { escapeHtml } from '../html';
import { getText } from '../http';

const baseUrl = 'https://www.tiktok.com';

/** Solves the `_wafchallengeid` proof of work the embed page asks for. */
export const solveWafChallenge = (cs: string) => {
    const challenge = JSON.parse(Buffer.from(cs, 'base64').toString());
    const prefix = Uint8Array.from(Buffer.from(challenge.v.a, 'base64'));
    const expected = Buffer.from(challenge.v.c, 'base64').toString('hex');
    for (let i = 0; i < 1_000_000; i++) {
        const hash = createHash('sha256').update(prefix).update(i.toString()).digest('hex');
        if (hash === expected) {
            challenge.d = Buffer.from(i.toString()).toString('base64');
            break;
        }
    }
    return Buffer.from(JSON.stringify(challenge)).toString('base64');
};

export const getUserFeed = async (user: string): Promise<Feed> => {
    const handle = user.startsWith('@') ? user : `@${user}`;
    if (!/^@[\w.]{1,64}$/.test(handle)) {
        throw badRequest('Invalid TikTok user, expected something like @linustech.');
    }
    const path = `/embed/${handle}`;

    const profile = await tryGet(
        `tiktok:user:${handle}`,
        async () => {
            let html = await getText(baseUrl + path);
            let $ = load(html);
            if ($('p#wci').hasClass('_wafchallengeid')) {
                const cookie = solveWafChallenge($('p#cs').attr('class')!);
                html = await getText(baseUrl + path, { headers: { cookie: `_wafchallengeid=${cookie};` } });
                $ = load(html);
            }
            const raw = $('script#__FRONTITY_CONNECT_STATE__').text();
            if (!raw) {
                throw new HttpError(502, 'TikTok embed page has an unexpected shape, TikTok may have blocked the request.');
            }
            const data = JSON.parse(raw).source?.data?.[path];
            if (!data?.userInfo) {
                throw new HttpError(502, 'TikTok returned no profile, the user may not exist.');
            }
            return data as { userInfo: any; videoList: any[] };
        },
        300
    );

    const { userInfo, videoList } = profile;
    return {
        title: `${userInfo.nickname} (@${userInfo.uniqueId}) | TikTok`,
        url: `${baseUrl}/@${userInfo.uniqueId}`,
        description: userInfo.signature,
        icon: userInfo.avatarThumbUrl,
        items: videoList.map((video) => ({
            url: `${baseUrl}/@${video.authorUniqueId}/video/${video.id}`,
            title: video.desc,
            contentHtml: `<video controls loop preload="metadata" poster="${escapeHtml(video.coverUrl)}"><source src="${escapeHtml(video.playAddr)}"></video>`,
            author: userInfo.nickname,
            // A video id carries its creation time in the upper 32 bits
            published: new Date(Number(BigInt(video.id) >> 32n) * 1000),
            image: video.coverUrl,
        })),
    };
};
