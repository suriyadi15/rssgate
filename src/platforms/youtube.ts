// Ported from RSSHub lib/routes/youtube/api/youtubei.ts, user.ts, channel.ts, playlist.ts, community.tsx
import { load } from 'cheerio';
import type { Helpers } from 'youtubei.js';
import { Innertube, YTNodes } from 'youtubei.js';

import { tryGet } from '../cache';
import { badRequest, HttpError, notFound } from '../errors';
import type { Feed, Item } from '../feed';
import { escapeHtml, img, textToHtml } from '../html';
import { getText, proxiedFetch } from '../http';
import { parseRelativeDate } from '../time';

let innertubePromise: Promise<Innertube> | undefined;
const getInnertube = () => {
    innertubePromise ??= Innertube.create({
        // Goes through the proxy of the running request
        fetch: ((input: RequestInfo | URL, init?: RequestInit) => proxiedFetch(input, init)) as typeof fetch,
    }).catch((error) => {
        innertubePromise = undefined;
        throw error;
    });
    return innertubePromise;
};

type VideoLockup = YTNodes.LockupView & { content_id: string };
const isVideoLockup = (node: Helpers.YTNode): node is VideoLockup => node instanceof YTNodes.LockupView && node.content_id !== undefined;

const metadataTexts = (video: YTNodes.LockupView) => (video.metadata?.metadata?.metadata_rows ?? []).flatMap((row) => row.metadata_parts ?? []).map((part) => part.text?.text);

const toItem = (video: VideoLockup): Item => {
    const id = video.content_id;
    const image = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
    const rows = (video.metadata?.metadata?.metadata_rows ?? []).filter((row) => row.metadata_parts?.length);
    const published = metadataTexts(video).findLast((text) => text?.endsWith('ago'));
    const url = `https://www.youtube.com/watch?v=${id}`;
    return {
        url,
        title: video.metadata?.title?.text || `YouTube Video ${id}`,
        contentHtml: `<a href="${url}">${img(image)}</a>`,
        author: rows.length > 1 ? rows[0].metadata_parts?.[0]?.text?.text : undefined,
        image,
        published: published ? parseRelativeDate(published) : undefined,
        attachments: [{ url: `https://www.youtube.com/embed/${id}`, mimeType: 'text/html', durationInSeconds: video.duration?.seconds || undefined }],
    };
};

const isChannelId = (id: string) => /^UC[\w-]{22}$/.test(id);

const guard = async <T>(what: string, fn: () => Promise<T>): Promise<T> => {
    try {
        return await fn();
    } catch (error) {
        if (error instanceof HttpError) {
            throw error;
        }
        throw new HttpError(502, `YouTube ${what} failed: ${(error as Error).message}`);
    }
};

export const getChannelIdByHandle = (handle: string) =>
    tryGet(`youtube:channelId:${handle}`, () =>
        guard('lookup', async () => {
            const innertube = await getInnertube();
            const endpoint = await innertube.resolveURL(`https://www.youtube.com/${handle.startsWith('@') ? handle : `@${handle}`}`);
            const id = endpoint.payload?.browseId;
            if (!id) {
                throw notFound(`YouTube channel ${handle} not found.`);
            }
            return id as string;
        })
    );

/** Videos of a channel. Shorts are left out unless `shorts` is set. */
export const getChannelFeed = (channelId: string, shorts = false): Promise<Feed> => {
    if (!isChannelId(channelId)) {
        throw badRequest('Invalid YouTube channel id, use /youtube/user/:handle for a handle.');
    }
    return guard('channel', async () => {
        const innertube = await getInnertube();
        const channel = await innertube.getChannel(channelId);
        const videos = shorts ? await innertube.getPlaylist(`UU${channelId.slice(2)}`) : await channel.getVideos();
        return {
            title: `${channel.metadata.title || channelId} - YouTube`,
            url: `https://www.youtube.com/channel/${channelId}`,
            description: channel.metadata.description,
            icon: channel.metadata.avatar?.[0]?.url,
            items: videos.videos.filter((video) => isVideoLockup(video)).map((video) => toItem(video)),
        };
    });
};

export const getPlaylistFeed = (playlistId: string): Promise<Feed> =>
    guard('playlist', async () => {
        const innertube = await getInnertube();
        const playlist = await innertube.getPlaylist(playlistId);
        return {
            title: `${playlist.info.title || playlistId} by ${playlist.info.author?.name} - YouTube`,
            url: `https://www.youtube.com/playlist?list=${playlistId}`,
            description: playlist.info.description || undefined,
            icon: playlist.info.thumbnails?.[0]?.url,
            items: playlist.videos.filter((video) => isVideoLockup(video)).map((video) => toItem(video)),
        };
    });

const communityDate = (value: string | undefined) => {
    const text = value?.split('(', 1)[0].trim();
    return text ? parseRelativeDate(text) : undefined;
};

const renderRuns = (runs: any[] | undefined, images: Array<{ url?: string } | undefined>) => {
    const text = (runs ?? [])
        .map((run) => {
            const url = run?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url as string | undefined;
            return url ? `<a href="${escapeHtml(url.startsWith('https://') ? url : `https://www.youtube.com${url}`)}">${escapeHtml(run.text)}</a>` : textToHtml(run?.text ?? '');
        })
        .join('');
    return text + images.map((i) => img(i?.url)).join('');
};

/** Community posts, scraped from the posts tab. */
export const getCommunityFeed = (handle: string): Promise<Feed> =>
    guard('community', async () => {
        const path = isChannelId(handle) ? `channel/${handle}` : handle.startsWith('@') ? handle : `@${handle}`;
        const html = await getText(`https://www.youtube.com/${path}/posts`);
        const script = load(html)('script')
            .toArray()
            .map((node) => load(node).text())
            .join('\n');
        const raw = script.match(/ytInitialData = (\{.*?\});/s)?.[1];
        if (!raw) {
            throw new HttpError(502, 'YouTube community page has an unexpected shape.');
        }
        const data = JSON.parse(raw);
        const meta = data.metadata?.channelMetadataRenderer;
        const tab = data.contents?.twoColumnBrowseResultsRenderer?.tabs?.find((t: any) => /\/(posts|community)$/.test(t.tabRenderer?.endpoint?.commandMetadata?.webCommandMetadata?.url ?? ''));
        const list = tab?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents ?? [];
        if (list[0]?.messageRenderer) {
            throw notFound(list[0].messageRenderer.text?.runs?.[0]?.text ?? 'No community posts.');
        }
        const items: Item[] = list
            .filter((entry: any) => entry.backstagePostThreadRenderer)
            .map((entry: any) => {
                const thread = entry.backstagePostThreadRenderer.post;
                const post = thread.backstagePostRenderer ?? thread.sharedPostRenderer.originalPost.backstagePostRenderer;
                const attachment = post.backstageAttachment;
                const images = attachment?.postMultiImageRenderer?.images?.map((i: any) => i.backstageImageRenderer.image.thumbnails.at(-1)) ?? [attachment?.backstageImageRenderer?.image?.thumbnails?.at(-1)];
                return {
                    url: `https://www.youtube.com/post/${post.postId}`,
                    title: post.contentText?.runs?.[0]?.text ?? '',
                    contentHtml: renderRuns(post.contentText?.runs, images),
                    author: post.authorText?.runs?.[0]?.text,
                    published: communityDate(post.publishedTimeText?.runs?.[0]?.text),
                };
            });
        return { title: `${meta?.title ?? handle} - Community Posts - YouTube`, url: meta?.channelUrl ?? `https://www.youtube.com/${path}`, description: meta?.description, items };
    });
