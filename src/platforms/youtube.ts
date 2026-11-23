// Ported from RSSHub lib/routes/youtube/api/youtubei.ts, user.ts, channel.ts, playlist.ts, community.tsx
import { load } from 'cheerio';
import type { Helpers } from 'youtubei.js';
import { Innertube, YTNodes } from 'youtubei.js';

import { tryGet } from '../cache';
import { badRequest, HttpError, needsCredential, notFound } from '../errors';
import type { Feed, Item } from '../feed';
import { escapeHtml, img, textToHtml } from '../html';
import { getEnv } from '../context';
import { getText, proxiedFetch, request } from '../http';
import { parseDate, parseRelativeDate } from '../time';

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

/** The channel id behind a custom URL (youtube.com/c/name), read from the channel page. */
export const getChannelIdByCustomUrl = (name: string) =>
    tryGet(`youtube:customUrl:${name}`, () =>
        guard('lookup', async () => {
            const html = await getText(`https://www.youtube.com/c/${encodeURIComponent(name)}`);
            const id = html.match(/"externalId":"(UC[\w-]{22})"/)?.[1] ?? html.match(/"channelId":"(UC[\w-]{22})"/)?.[1];
            if (!id) {
                throw notFound(`YouTube channel ${name} not found.`);
            }
            return id;
        })
    );

type StreamState = 'live' | 'upcoming' | 'completed';

const streamState = (video: YTNodes.LockupView): StreamState => {
    const thumbnail = video.content_image?.is(YTNodes.ThumbnailView) ? video.content_image : undefined;
    const badges = thumbnail?.overlays.filter((overlay) => overlay.is(YTNodes.ThumbnailBottomOverlayView)).flatMap((overlay) => overlay.badges ?? []) ?? [];
    if (badges.some((badge) => badge.badge_style === 'THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE')) {
        return 'live';
    }
    if (badges.some((badge) => badge.text === 'Upcoming') || metadataTexts(video).some((text) => text?.startsWith('Scheduled for '))) {
        return 'upcoming';
    }
    return 'completed';
};

/** The lockup of a video only has its title, the description takes one player request per video. */
const getVideoInfo = (videoId: string) =>
    tryGet(
        `youtube:videoInfo:${videoId}`,
        () =>
            guard('video', async () => {
                const info = await (await getInnertube()).getBasicInfo(videoId);
                return { description: info.basic_info.short_description ?? '', startTimestamp: info.basic_info.start_timestamp?.toISOString() };
            }),
        3600
    );

/** Live, upcoming and completed streams of a channel, the state is the tag of each item. */
export const getLiveFeed = (channelId: string): Promise<Feed> => {
    if (!isChannelId(channelId)) {
        throw badRequest('Invalid YouTube channel id.');
    }
    return guard('live', async () => {
        const innertube = await getInnertube();
        const channel = await innertube.getChannel(channelId);
        const videos = (await channel.getLiveStreams()).videos.filter((video) => isVideoLockup(video));
        const infos = await Promise.all(videos.map((video) => getVideoInfo(video.content_id)));
        return {
            title: `${channel.metadata.title || channelId} - Live - YouTube`,
            url: `https://www.youtube.com/channel/${channelId}/streams`,
            description: channel.metadata.description,
            icon: channel.metadata.avatar?.[0]?.url,
            items: videos.map((video, index) => {
                const item = toItem(video);
                const { description, startTimestamp } = infos[index];
                return {
                    ...item,
                    contentHtml: item.contentHtml + (description ? `<p>${textToHtml(description)}</p>` : ''),
                    published: startTimestamp ? new Date(startTimestamp) : item.published,
                    tags: [streamState(video)],
                };
            }),
        };
    });
};

export const getShowsFeed = (channelId: string): Promise<Feed> => {
    if (!isChannelId(channelId)) {
        throw badRequest('Invalid YouTube channel id.');
    }
    return guard('shows', async () => {
        const innertube = await getInnertube();
        const channel = await innertube.getChannel(channelId);
        const shows = await channel.getShows();
        return {
            title: `${channel.metadata.title || channelId} - Shows - YouTube`,
            url: `https://www.youtube.com/channel/${channelId}/shows`,
            description: channel.metadata.description,
            icon: channel.metadata.avatar?.[0]?.url,
            items: shows.playlists
                .filter((show) => show instanceof YTNodes.GridShow)
                .map((show) => {
                    const image = show.thumbnail_renderer?.thumbnail[0]?.url.replace(/\/hqdefault\.jpg\?.*$/, '/maxresdefault.jpg');
                    const episodes = show.thumbnail_overlays[0]?.text?.text;
                    return {
                        url: new URL(show.endpoint.metadata.url!, 'https://www.youtube.com').href,
                        title: show.title.toString(),
                        contentHtml: `${img(image)}${image && episodes ? '<br>' : ''}${escapeHtml(episodes ?? '')}`,
                        author: show.author.name,
                        image,
                    };
                }),
        };
    });
};

const chartKinds = {
    TopArtists: { contentKey: 'artists', viewKey: 'artistViews', title: 'Top artists' },
    TopSongs: { contentKey: 'trackTypes', viewKey: 'trackViews', title: 'Top songs' },
    TopVideos: { contentKey: 'videos', viewKey: 'videoViews', title: 'Top music videos' },
    TrendingVideos: { contentKey: 'videos', viewKey: 'videoViews', title: 'Trending' },
} as const;

/** YouTube Music charts: TopArtists, TopSongs, TopVideos (default) or TrendingVideos, global or of a country code such as `us`. */
export const getChartsFeed = async (category = 'TopVideos', country?: string): Promise<Feed> => {
    if (!Object.hasOwn(chartKinds, category)) {
        throw badRequest('Invalid YouTube chart category. Choose from TopArtists, TopSongs, TopVideos, TrendingVideos.');
    }
    if (country !== undefined && !/^[a-z]{2}$/i.test(country)) {
        throw badRequest('country must be a two letter country code such as us or jp.');
    }
    const kind = chartKinds[category as keyof typeof chartKinds];
    const content: any = await tryGet(
        `youtube:charts:${country?.toLowerCase() ?? 'global'}`,
        () =>
            guard('charts', async () => {
                const response = await request('https://charts.youtube.com/youtubei/v1/browse?alt=json&key=AIzaSyCzEW7JUJdSql0-2V4tHUb6laYm4iAE_dM', {
                    method: 'POST',
                    json: {
                        browseId: 'FEmusic_analytics_charts_home',
                        context: {
                            capabilities: {},
                            client: { clientName: 'WEB_MUSIC_ANALYTICS', clientVersion: '0.2', experimentIds: [], experimentsToken: '', gl: 'US', hl: 'en', theme: 'MUSIC' },
                            request: { internalExperimentFlags: [] },
                        },
                        query: `chart_params_type=WEEK&perspective=CHART&flags=viral_video_chart&selected_chart=TRACKS&chart_params_id=weekly:0:0${country ? `:${country.toLowerCase()}` : ''}`,
                    },
                });
                if (!response.ok) {
                    // The key RSSHub ships with is refused at times, that is not a credential of the caller
                    throw new HttpError(502, `YouTube Music charts answered ${response.status}, the shared web key of the charts site may have been revoked.`);
                }
                const data: any = await response.json();
                return data.contents.sectionListRenderer.contents[0].musicAnalyticsSectionRenderer.content;
            })
    );
    const views: any[] = content[kind.contentKey]?.[category === 'TrendingVideos' ? 1 : 0]?.[kind.viewKey] ?? [];
    const items: Item[] =
        category === 'TopArtists'
            ? views.map((item) => ({ url: `https://charts.youtube.com/artist/${encodeURIComponent(item.id)}`, title: item.name, contentHtml: escapeHtml(item.name) }))
            : views.map((item) => {
                  const videoId = category === 'TopSongs' ? item.encryptedVideoId : item.id;
                  const author = (item.artists ?? [])
                      .filter((a: any) => a.name)
                      .map((a: any) => a.name)
                      .join(', ');
                  const thumbnail = item.thumbnail?.thumbnails?.at(-1)?.url;
                  const url = `https://www.youtube.com/watch?v=${videoId}`;
                  return { url, title: `${item.title ?? item.name} - ${author}`, contentHtml: `<a href="${url}">${img(thumbnail)}</a>`, author, image: thumbnail };
              });
    return { title: `YouTube Music Charts - ${kind.title}`, url: `https://charts.youtube.com/charts/${category}/${country?.toLowerCase() ?? 'global'}`, items };
};

// --- subscriptions of an account (Google OAuth) ---
const googleApi = 'https://www.googleapis.com/youtube/v3';

const getAccessToken = () => {
    const clientId = getEnv('YOUTUBE_CLIENT_ID');
    const clientSecret = getEnv('YOUTUBE_CLIENT_SECRET');
    const refreshToken = getEnv('YOUTUBE_REFRESH_TOKEN');
    if (!clientId || !clientSecret || !refreshToken) {
        throw needsCredential('YouTube subscriptions need YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET and YOUTUBE_REFRESH_TOKEN.');
    }
    // Access tokens live an hour
    return tryGet(
        'youtube:accessToken',
        async () => {
            const response = await request('https://oauth2.googleapis.com/token', {
                method: 'POST',
                body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
            });
            const body: any = await response.json().catch(() => ({}));
            if (!response.ok || !body.access_token) {
                throw needsCredential('Google refused the YouTube OAuth credentials, they are wrong or revoked.');
            }
            return body.access_token as string;
        },
        3300
    );
};

const googleGet = async (path: string, params: Record<string, string>) => {
    const token = await getAccessToken();
    const response = await request(`${googleApi}/${path}?${new URLSearchParams(params)}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
    if (response.status === 401 || response.status === 403) {
        const body: any = await response.json().catch(() => ({}));
        const quota = body?.error?.errors?.some((e: any) => /quota|rateLimit/i.test(e?.reason ?? ''));
        throw quota ? new HttpError(429, 'YouTube API quota is used up, try again later.') : needsCredential('Google refused the YouTube OAuth credentials or scope (youtube.readonly).');
    }
    if (!response.ok) {
        throw new HttpError(502, `YouTube API answered ${response.status}.`);
    }
    return response.json() as Promise<any>;
};

const pageThrough = async (path: string, params: Record<string, string>) => {
    const items: any[] = [];
    let pageToken: string | undefined;
    do {
        // oxlint-disable-next-line no-await-in-loop - depends on the previous page
        const page = await googleGet(path, { ...params, maxResults: '50', ...(pageToken && { pageToken }) });
        items.push(...(page.items ?? []));
        pageToken = page.nextPageToken;
    } while (pageToken);
    return items;
};

/** The latest uploads of every channel the account subscribes to. */
export const getSubscriptionsFeed = (): Promise<Feed> =>
    guard('subscriptions', async () => {
        const subscriptions = await tryGet('youtube:subscriptions', () => pageThrough('subscriptions', { part: 'snippet', mine: 'true' }), 3600);
        const channelIds: string[] = subscriptions.map((item) => item.snippet.resourceId.channelId);
        const uploads: string[] = [];
        for (let i = 0; i < channelIds.length; i += 50) {
            // oxlint-disable-next-line no-await-in-loop - one request per 50 channels
            const channels = await googleGet('channels', { part: 'contentDetails', id: channelIds.slice(i, i + 50).join(','), maxResults: '50' });
            uploads.push(...(channels.items ?? []).map((channel: any) => channel.contentDetails?.relatedPlaylists?.uploads).filter(Boolean));
        }
        const lists: any[][] = Array.from({ length: uploads.length });
        let next = 0;
        await Promise.all(
            Array.from({ length: Math.min(10, uploads.length) }, async () => {
                while (next < uploads.length) {
                    const index = next++;
                    // A channel without uploads or a private playlist is skipped, not a failure of the feed
                    // oxlint-disable-next-line no-await-in-loop
                    lists[index] = await tryGet(`youtube:uploads:${uploads[index]}`, () => googleGet('playlistItems', { part: 'snippet', playlistId: uploads[index], maxResults: '50' }).then((page) => page.items ?? []), 600).catch((error) => {
                        if (error instanceof HttpError && error.status !== 502) {
                            throw error;
                        }
                        return [];
                    });
                }
            })
        );
        const items: Item[] = lists
            .flat()
            .filter((video) => video?.snippet && video.snippet.title !== 'Private video' && video.snippet.title !== 'Deleted video')
            .map((video) => {
                const { snippet } = video;
                const videoId = snippet.resourceId.videoId;
                const thumbnails = snippet.thumbnails ?? {};
                const image = (thumbnails.maxres ?? thumbnails.standard ?? thumbnails.high ?? thumbnails.medium ?? thumbnails.default)?.url as string | undefined;
                const url = `https://www.youtube.com/watch?v=${videoId}`;
                return {
                    url,
                    title: snippet.title,
                    contentHtml: `<a href="${url}">${img(image)}</a>${snippet.description ? `<p>${textToHtml(snippet.description)}</p>` : ''}`,
                    published: parseDate(snippet.publishedAt),
                    author: snippet.videoOwnerChannelTitle,
                    image,
                };
            })
            .toSorted((a, b) => (b.published?.getTime() ?? 0) - (a.published?.getTime() ?? 0));
        return { title: 'Subscriptions - YouTube', url: 'https://www.youtube.com/feed/subscriptions', description: 'YouTube Subscriptions', items };
    });
