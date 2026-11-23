// Ported from RSSHub lib/routes/threads/utils.ts and index.ts (default options)
import { type CheerioAPI, load } from 'cheerio';

import { badRequest, HttpError, notFound } from '../errors';
import type { Feed, Item } from '../feed';
import { escapeHtml, img, textToHtml, video } from '../html';
import { getText } from '../http';
import { parseDate } from '../time';

const profileUrl = (user: string) => `https://www.threads.com/@${user}`;
const threadUrl = (code: string) => `https://www.threads.com/t/${code}`;

type Post = Record<string, any>;

const findAll = (node: unknown, acc: any[] = []): any[] => {
    if (node instanceof Object) {
        if (Array.isArray((node as any).thread_items)) {
            acc.push(...(node as any).thread_items);
        }
        for (const value of Object.values(node)) {
            findAll(value, acc);
        }
    }
    return acc;
};

const findProfile = (node: unknown): Post | undefined => {
    if (!(node instanceof Object)) {
        return;
    }
    if ('biography' in node) {
        return node as Post;
    }
    for (const value of Object.values(node)) {
        const found = findProfile(value);
        if (found) {
            return found;
        }
    }
};

const mediaHtml = (media: Post) => {
    const image = media.image_versions2?.candidates?.[0]?.url as string | undefined;
    const clip = media.video_versions?.[0]?.url as string | undefined;
    return clip ? video(clip, image) : img(image);
};
const hasMedia = (post: Post) => post.image_versions2 || post.carousel_media || post.video_versions;
const postMedia = (post: Post) => (post.carousel_media ?? [post]).map((media: Post) => mediaHtml(media)).join('');

const toItem = (post: Post): Item => {
    const embedded = post.text_post_app_info?.share_info?.quoted_post ?? post.text_post_app_info?.share_info?.reposted_post;
    const isReply = post.text_post_app_info?.reply_to_author;
    const username = post.user?.username ?? '';
    let title = `@${username}: ${post.caption?.text ?? ''}`;
    let html = `<p><strong>@${escapeHtml(username)}</strong>${embedded ? ' 🔁' : isReply ? ' ↩️' : ''}:</p>`;
    if (post.caption?.text) {
        html += `<p>${textToHtml(post.caption.text)}</p>`;
    }
    if (hasMedia(post)) {
        html += `<p>${postMedia(post)}</p>`;
    }
    if (embedded) {
        title += ` 🔁 @${embedded.user?.username}: "${embedded.caption?.text}"`;
        html += `<blockquote><p>${textToHtml(embedded.caption?.text ?? '')}</p>`;
        if (hasMedia(embedded)) {
            html += `<p>${postMedia(embedded)}</p>`;
        }
        html += `— @${escapeHtml(embedded.user?.username ?? '')} — <a href="${threadUrl(embedded.code)}">${threadUrl(embedded.code)}</a></blockquote>`;
    }
    return { url: threadUrl(post.code), title, contentHtml: html, author: username, published: parseDate(post.taken_at) };
};

const extractThreadItems = ($: CheerioAPI): any[] => {
    let threads: any[] = [];
    $('script[data-sjs]:contains("thread_items")').each((_, script) => {
        threads = findAll(JSON.parse($(script).text()));
        return threads.length === 0;
    });
    return threads;
};

export const getUserFeed = async (rawUser: string, options: { replies?: boolean } = {}): Promise<Feed> => {
    const user = rawUser.startsWith('@') ? rawUser.slice(1) : rawUser;
    const $ = load(await getText(options.replies ? `${profileUrl(user)}/replies` : profileUrl(user)));

    const threads = extractThreadItems($);
    if (!threads.length && !$('script[data-sjs]:contains("mediaData")').text().includes('"mediaData":{"edges":[]')) {
        throw new HttpError(502, 'Threads page has an unexpected shape, the profile may not exist or Threads asked for a login.');
    }

    let profile: Post | undefined;
    $('script[data-sjs]:contains("biography")').each((_, script) => {
        profile = findProfile(JSON.parse($(script).text()));
        return !profile;
    });
    if (!profile && !threads.length) {
        throw notFound(`Threads user ${user} not found.`);
    }

    return {
        title: `${profile?.full_name || user} (@${user}) on Threads`,
        url: profileUrl(user),
        description: profile?.biography,
        icon: profile?.profile_pic_url ?? threads[0]?.post?.user?.profile_pic_url,
        items: threads.filter((item) => item.post?.user?.username === user).map((item) => toItem(item.post)),
    };
};

/** serpType: tags (default), default or recent */
export const getSearchFeed = async (keyword: string, serpType = 'tags'): Promise<Feed> => {
    if (!['tags', 'default', 'recent'].includes(serpType)) {
        throw badRequest('serpType must be tags, default or recent.');
    }
    const url = `https://www.threads.com/search?q=${encodeURIComponent(keyword)}&serp_type=${serpType}`;
    const $ = load(await getText(url));
    const threads = extractThreadItems($);
    // A search without results still embeds the response with empty edges, only a page without it is a failure
    if (!threads.length && !$('script[data-sjs]:contains("searchResults")').text().includes('"edges":[]')) {
        throw new HttpError(502, 'Threads page has an unexpected shape, Threads may have asked for a login.');
    }
    return { title: `${keyword} - Search on Threads`, url, items: threads.map((item) => toItem(item.post)) };
};

const findNodes = (node: unknown, predicate: (node: any) => boolean, acc: any[] = []): any[] => {
    if (node instanceof Object) {
        if (predicate(node)) {
            acc.push(node);
        }
        for (const value of Object.values(node)) {
            findNodes(value, predicate, acc);
        }
    }
    return acc;
};

/** A post and its replies. */
export const getPostFeed = async (rawUser: string, id: string): Promise<Feed> => {
    const user = rawUser.startsWith('@') ? rawUser.slice(1) : rawUser;
    const url = `${profileUrl(user)}/post/${encodeURIComponent(id)}`;
    const $ = load(await getText(url));
    const relay = (predicate: (node: any) => boolean) =>
        $('script[data-sjs]:contains("RelayPrefetchedStreamCache")')
            .toArray()
            .flatMap((script) => findNodes(JSON.parse($(script).text()), predicate));

    const [post] = relay((node) => node.code === id && node.taken_at);
    if (!post) {
        throw notFound(`Threads post ${id} not found.`);
    }
    const replies = relay((node) => node.direct_replies).flatMap((node) => node.direct_replies.edges.flatMap((thread: any) => thread.node.posts.edges.map((edge: any) => edge.node)));
    return {
        title: `@${post.user?.username}: ${post.caption?.text ?? ''}`,
        url,
        icon: post.user?.profile_pic_url,
        items: [post, ...replies].map((p) => toItem(p)),
    };
};
