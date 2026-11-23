// Ported from RSSHub lib/routes/tiktok/user.ts and the WAF solver of lib/routes/juejin/utils.ts
import { createHash } from 'node:crypto';

import { load } from 'cheerio';

import { tryGet } from '../cache';
import { badRequest, HttpError } from '../errors';
import type { Feed } from '../feed';
import { escapeHtml } from '../html';
import { getJson, getText } from '../http';

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

type LiveInfo = { user: any; liveRoom: any };

const apiLiveRoom = async (handle: string): Promise<LiveInfo | null> => {
    const { data } = await getJson(`${baseUrl}/api-live/user/room/?${new URLSearchParams({ aid: '1988', sourceType: '54', uniqueId: handle })}`);
    return data?.user?.uniqueId ? data : null;
};

const htmlLiveRoom = async (link: string): Promise<LiveInfo> => {
    let $ = load(await getText(link));
    if ($('p#wci').hasClass('_wafchallengeid')) {
        const cookie = solveWafChallenge($('p#cs').attr('class')!);
        $ = load(await getText(link, { headers: { cookie: `_wafchallengeid=${cookie};` } }));
    }
    const state = $('script#SIGI_STATE').text();
    if (!state) {
        throw new HttpError(502, 'TikTok live page has an unexpected shape, TikTok may have blocked the request.');
    }
    return JSON.parse(state).LiveRoom.liveRoomUserInfo;
};

const isAlive = async (roomId: string): Promise<boolean | null> => {
    const { data } = await getJson(`https://webcast.tiktok.com/webcast/room/check_alive/?${new URLSearchParams({ aid: '1988', room_ids: roomId })}`);
    return data?.[0]?.alive ?? null;
};

/** Whether a user is live right now. */
export const getLiveFeed = async (user: string): Promise<Feed> => {
    const handle = user.startsWith('@') ? user.slice(1) : user;
    if (!/^[\w.]{1,64}$/.test(handle)) {
        throw badRequest('Invalid TikTok user, expected something like @shinichifuku.');
    }
    const link = `${baseUrl}/@${handle}/live`;
    const { user: info, liveRoom } = await tryGet(
        `tiktok:live:${handle}`,
        async () => {
            const room = (await apiLiveRoom(handle)) ?? (await htmlLiveRoom(link));
            if (!room.user.roomId) {
                return room;
            }
            const alive = await isAlive(room.user.roomId);
            return alive === null ? room : { ...room, liveRoom: { ...room.liveRoom, status: alive ? 2 : 4 } };
        },
        300
    );
    const status = liveRoom.status;
    const title = status === 2 ? liveRoom.title || `${info.nickname}'s going live now!` : status === 4 ? `${info.nickname} is not live currently.` : `${info.nickname}'s live status is unknown (status ${status}).`;
    return {
        title: `${info.nickname} (@${info.uniqueId})'s Live Stream - TikTok`,
        url: link,
        description: info.signature,
        icon: info.avatarLarger || info.avatarMedium || info.avatarThumb,
        // The fragment makes every change of the live status a new item
        items: [
            {
                url: `${link}#${info.roomId || info.uniqueId}:${liveRoom.streamId || liveRoom.startTime || ''}:${status}`,
                title,
                contentHtml: '',
                author: info.nickname,
                published: liveRoom.startTime ? new Date(Number(liveRoom.startTime) * 1000) : undefined,
            },
        ],
    };
};
