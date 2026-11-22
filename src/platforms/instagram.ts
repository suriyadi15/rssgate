// Ported from RSSHub lib/routes/instagram/index.ts, web-api/utils.ts and templates/render.ts (user feed only)
import { CookieJar } from 'tough-cookie';

import { tryGet } from '../cache';
import { getEnv } from '../context';
import { HttpError, needsCredential, notFound } from '../errors';
import type { Feed, Item } from '../feed';
import { escapeHtml, img, textToHtml, video } from '../html';
import { request } from '../http';
import { parseDate } from '../time';

const baseUrl = 'https://www.instagram.com';

// Persisted query ids of the web app, they change when Instagram ships a new build
const docIds = {
    PolarisLoggedOutDesktopWWWPostRootContentQuery: '28459077533770840',
    PolarisLoggedOutDesktopWWWProfilePostsTabContentQuery_connection: '28904005159232689',
    PolarisProfilePageContentQuery: '28036671149327607',
    PolarisProfilePostsQuery: '28570182382647478',
};

type Tokens = { lsd?: string; dtsg?: string };
type User = {
    id: string;
    username: string;
    is_private: boolean;
    friendship_status?: { following: boolean };
    full_name: string;
    biography?: string;
    profile_pic_url: string;
    hd_profile_pic_url_info?: { url: string };
};

const csrfOf = async (jar: CookieJar) => (await jar.getCookieString(baseUrl)).match(/csrftoken=([^;]+)/)?.[1];

const apiHeaders = async (jar: CookieJar) => {
    const csrf = await csrfOf(jar);
    return {
        accept: '*/*',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'x-asbd-id': '359341',
        ...(csrf && { 'x-csrftoken': csrf }),
        'x-ig-app-id': '936619743392459',
        'x-ig-www-claim': '0',
        cookie: await jar.getCookieString(baseUrl),
    };
};

const loadPage = async (url: string, jar: CookieJar) => {
    const response = await request(url, { headers: { cookie: await jar.getCookieString(baseUrl) } });
    await Promise.all(response.headers.getSetCookie().map((c) => jar.setCookie(c, baseUrl)));
    const html = await response.text();
    const csrf = /"csrf_token":"([A-Za-z0-9]+)"/.exec(html)?.[1];
    if (csrf && !(await csrfOf(jar))) {
        await jar.setCookie(`csrftoken=${csrf}; Path=/; Secure`, baseUrl);
    }
    return { html, url: response.url };
};

const checkLogin = async (jar: CookieJar) => {
    const response = await request(`${baseUrl}/api/v1/web/fxcal/ig_sso_users/`, {
        method: 'POST',
        headers: { ...(await apiHeaders(jar)), 'content-type': 'application/x-www-form-urlencoded' },
    });
    const body: any = await response.json().catch(() => ({}));
    return body.status === 'ok';
};

const graphql = async (name: keyof typeof docIds, variables: Record<string, unknown>, tokens: Tokens, jar: CookieJar) => {
    const response = await request(`${baseUrl}/api/graphql`, {
        method: 'POST',
        headers: { ...(await apiHeaders(jar)), ...(tokens.lsd && { 'x-fb-lsd': tokens.lsd }) },
        body: new URLSearchParams({
            ...(tokens.lsd && { lsd: tokens.lsd }),
            ...(tokens.dtsg && { fb_dtsg: tokens.dtsg }),
            fb_api_req_friendly_name: name,
            variables: JSON.stringify(variables),
            doc_id: docIds[name],
        }),
    });
    const text = await response.text();
    if (text.startsWith('<')) {
        throw needsCredential('Instagram refused the cookie, INSTAGRAM_COOKIE is missing, expired or blocked.');
    }
    const data = JSON.parse(text.replace(/^for \(;;\);/, ''));
    if (!data.data) {
        throw new HttpError(502, `Instagram ${name} failed: ${data.errors?.[0]?.message ?? 'no data'}`);
    }
    return data.data;
};

const findKey = (value: any, key: string): any => {
    if (value === null || typeof value !== 'object') {
        return;
    }
    if (Object.hasOwn(value, key)) {
        return value[key];
    }
    for (const child of Object.values(value)) {
        const found = findKey(child, key);
        if (found) {
            return found;
        }
    }
};

const guestUser = (html: string): User | undefined =>
    [...html.matchAll(/data-sjs>([^<]*"xig_user_by_username":[^<]*)<\/script>/g)].map((m) => findKey(JSON.parse(m[1]), 'xig_user_by_username')).find((user) => user?.full_name !== undefined);

const mapLimit = async <T, R>(list: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
    const out: R[] = Array.from({ length: list.length });
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, list.length) }, async () => {
            while (next < list.length) {
                const i = next++;
                // eslint-disable-next-line no-await-in-loop
                out[i] = await fn(list[i]);
            }
        })
    );
    return out;
};

const biggest = (media: any) => media.image_versions2.candidates.toSorted((a: any, b: any) => b.width - a.width)[0];

const renderMedia = (media: any, summary: string, alt?: string) => {
    const image = biggest(media);
    const text = summary ? `<p>${textToHtml(summary)}</p>` : '';
    return media.media_type === 2 || media.video_versions?.length ? `${text}${video(media.video_versions[0].url, image.url)}` : `${text}${img(image.url, alt)}`;
};

const renderItem = (node: any): Item => {
    const summary: string = node.caption?.text ?? '';
    let html: string;
    switch (node.product_type) {
        case 'carousel_container': {
            html = node.carousel_media.map((media: any, index: number) => renderMedia(media, index === 0 ? summary : '', node.accessibility_caption)).join('<br>');
            break;
        }
        case 'clips':
        case 'igtv':
        case 'longform':
        case 'feed':
        case 'story': {
            html = renderMedia(node, summary, node.accessibility_caption);
            break;
        }
        default:
            throw new HttpError(502, `Instagram: unhandled post type ${node.product_type}`);
    }
    const music = node.clips_metadata?.music_info?.music_asset_info;
    if (music?.title || music?.display_artist) {
        html += `<p>🎵 ${escapeHtml([music.title, music.display_artist].filter(Boolean).join(' - '))}</p>`;
    }
    if (node.pk === undefined || node.pk === null || node.pk === '') {
        throw new HttpError(502, 'Instagram media is missing its id');
    }
    const timestamp = node.caption?.created_at_utc || node.taken_at;
    return {
        url: `${baseUrl}/p/${node.code}/`,
        title: summary.split('\n', 1)[0] || node.accessibility_caption || `Post by @${node.user?.username}`,
        contentHtml: html,
        author: node.user?.username,
        published: timestamp ? parseDate(timestamp) : undefined,
    };
};

export const getUserFeed = async (username: string): Promise<Feed> => {
    const cookie = getEnv('INSTAGRAM_COOKIE');
    const jar = new CookieJar();
    if (cookie) {
        await Promise.all(cookie.split(/;\s*/).map((c) => jar.setCookie(c, baseUrl)));
    }

    const page = await loadPage(`${baseUrl}/${encodeURIComponent(username)}/`, jar);
    if (page.url.includes('/accounts/login/')) {
        throw needsCredential(cookie ? 'Instagram refused the cookie, INSTAGRAM_COOKIE is expired or blocked.' : 'Instagram asked for a login, send INSTAGRAM_COOKIE.');
    }
    if (page.url.includes('/accounts/suspended/')) {
        throw needsCredential('The Instagram account of the cookie is suspended.');
    }
    const { html } = page;
    const profileId = html.match(/"profile_id":"(\d+)"/)?.[1];
    if (!profileId) {
        throw notFound(`Instagram user @${username} not found.`);
    }
    const tokens: Tokens = {
        lsd: html.match(/"LSD",\[\],\{"token":"([^"]+)"/)?.[1],
        dtsg: html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/)?.[1],
    };
    if (cookie && !(await checkLogin(jar))) {
        throw needsCredential('Instagram refused the cookie, INSTAGRAM_COOKIE is expired or blocked.');
    }

    let user: User | undefined;
    let nodes: any[];
    if (tokens.dtsg) {
        const profile = await graphql(
            'PolarisProfilePageContentQuery',
            {
                id: profileId,
                enable_integrity_filters: true,
                render_surface: 'PROFILE',
                __relay_internal__pv__PolarisCannesGuardianExperienceEnabledrelayprovider: false,
                __relay_internal__pv__PolarisCASB976ProfileEnabledrelayprovider: false,
                __relay_internal__pv__PolarisWebSchoolsEnabledrelayprovider: false,
                __relay_internal__pv__PolarisRepostsConsumptionEnabledrelayprovider: false,
                __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: false,
            },
            tokens,
            jar
        );
        user = profile.user;
        if (user!.is_private && !user!.friendship_status?.following) {
            throw needsCredential(`@${user!.username} is private, send INSTAGRAM_COOKIE of an account that follows it.`);
        }
        const posts = await graphql(
            'PolarisProfilePostsQuery',
            {
                data: { count: 33, include_reel_media_seen_timestamp: true, include_relationship_info: true, latest_besties_reel_media: true, latest_reel_media: true },
                username,
                __relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider: false,
                __relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider: false,
                __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: false,
            },
            tokens,
            jar
        );
        nodes = posts.xdt_api__v1__feed__user_timeline_graphql_connection.edges.map((edge: any) => edge.node);
    } else {
        user = guestUser(html);
        if (!user) {
            throw new HttpError(502, 'Instagram page has an unexpected shape.');
        }
        if (user.is_private) {
            throw needsCredential(`@${user.username} is private, send INSTAGRAM_COOKIE of an account that follows it.`);
        }
        const timeline = await graphql('PolarisLoggedOutDesktopWWWProfilePostsTabContentQuery_connection', { first: 33, id: user.id, __relay_internal__pv__PolarisSEOIsCrawlerrelayprovider: false }, tokens, jar);
        const guestNodes: any[] = timeline.node.polaris_ordered_timeline_connection.edges.map((edge: any) => edge.node).filter((node: any) => node.user.id === user!.id);
        const details = await mapLimit(guestNodes, 3, (node) =>
            node.media_type === 1
                ? Promise.resolve({})
                : tryGet(`instagram:media:${node.pk}`, async () => {
                      const { xig_polaris_media: media } = await graphql('PolarisLoggedOutDesktopWWWPostRootContentQuery', { media_id: node.pk }, tokens, jar);
                      const detail = media.if_not_gated_logged_out ?? {};
                      delete detail.user;
                      return detail;
                  })
        );
        nodes = guestNodes.map((node, index) => {
            const date = node.accessibility_caption?.match(/ on ([A-Z][a-z]+ \d{1,2}, \d{4})\./)?.[1];
            return {
                ...node,
                product_type: 'feed',
                image_versions2: { candidates: [{ url: node.display_uri }] },
                taken_at: date ? Date.parse(`${date} UTC`) / 1000 : undefined,
                ...details[index],
            };
        });
    }

    return {
        title: `${user!.full_name} (@${user!.username}) - Instagram`,
        url: `${baseUrl}/${user!.username}`,
        description: user!.biography,
        icon: user!.hd_profile_pic_url_info?.url ?? user!.profile_pic_url,
        items: nodes.map((node) => renderItem(node)),
    };
};
