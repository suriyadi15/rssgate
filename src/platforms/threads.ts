// Ported from RSSHub lib/routes/threads/utils.ts and index.ts (default options)
import { load } from 'cheerio';

import { HttpError, notFound } from '../errors';
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

export const getUserFeed = async (rawUser: string): Promise<Feed> => {
    const user = rawUser.startsWith('@') ? rawUser.slice(1) : rawUser;
    const $ = load(await getText(profileUrl(user)));

    let threads: any[] = [];
    $('script[data-sjs]:contains("thread_items")').each((_, script) => {
        threads = findAll(JSON.parse($(script).text()));
        return threads.length === 0;
    });
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
