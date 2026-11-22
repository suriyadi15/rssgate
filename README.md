# rssgate

A small service that returns feeds (JSON Feed 1.1) of Twitter/X, Instagram, Threads, Facebook, TikTok and YouTube for a backend of your own.
Credentials and a proxy travel with each request. The scraping logic is ported from [RSSHub](https://github.com/DIYgod/RSSHub), see `UPSTREAM.md`.

## Run

```bash
docker run -d -p 3000:3000 -e ACCESS_KEY=change-me ghcr.io/suriyadi15/rssgate:latest
# or build it yourself: docker build -t rssgate .
# or without Docker: bun install && ACCESS_KEY=change-me bun src/index.ts
```

Image tags on `ghcr.io/suriyadi15/rssgate` (linux/amd64 and linux/arm64): `latest` is the head of `main`, `sha-<commit>` is one build, `X.Y.Z` and `X.Y` follow the git tags `vX.Y.Z`.

| Env           | Default | Meaning                                                  |
| ------------- | ------- | -------------------------------------------------------- |
| `ACCESS_KEY`  | none    | Required, the process stops without it                   |
| `PORT`        | 3000    |                                                          |
| `CACHE_TTL`   | 300     | Seconds a finished feed is kept                          |
| `CONTENT_TTL` | 3600    | Seconds details (user ids, tokens, ...) are kept         |

`TWITTER_AUTH_TOKEN`, `INSTAGRAM_COOKIE`, `FACEBOOK_COOKIE` and `PROXY_URI` may also be set as process env, they are the defaults for requests that bring none.

## Request

```bash
curl -H 'Authorization: Bearer change-me' \
     -H 'X-Rssgate-Config: {"TWITTER_AUTH_TOKEN":"<auth_token cookie>","PROXY_URI":"socks5h://user:pass@host:1080"}' \
     'http://localhost:3000/twitter/user/jack?limit=10'
```

- `Authorization: Bearer <ACCESS_KEY>` (or `?key=`) is required, except for `/healthz`.
- `X-Rssgate-Config` is a JSON object, only `TWITTER_AUTH_TOKEN`, `INSTAGRAM_COOKIE`, `FACEBOOK_COOKIE` and `PROXY_URI` (`http`, `https`, `socks5`, `socks5h`) are accepted. Values are never logged or echoed.
- `limit=N` (1..100) trims the items. `Cache-Control: no-cache` skips the feed cache.
- Cache entries are keyed by the credentials of the request: data fetched with one account is never served to another account or to a request without credentials.

| Route                                | Credential                                         | Query                                         |
| ------------------------------------ | -------------------------------------------------- | --------------------------------------------- |
| `/twitter/user/:id`                  | `TWITTER_AUTH_TOKEN`                               | `includeReplies`, `includeRts`, `onlyMedia`   |
| `/twitter/home`                      | `TWITTER_AUTH_TOKEN`                               | `includeRts`, `onlyMedia`                     |
| `/twitter/list/:id`                  | `TWITTER_AUTH_TOKEN`                               |                                               |
| `/twitter/keyword/:keyword`          | `TWITTER_AUTH_TOKEN`                               |                                               |
| `/twitter/tweet/:id/status/:status`  | `TWITTER_AUTH_TOKEN`                               |                                               |
| `/instagram/user/:user`              | optional `INSTAGRAM_COOKIE` (needed for private)   |                                               |
| `/threads/:user`                     | none                                               |                                               |
| `/facebook/page/:id`                 | optional `FACEBOOK_COOKIE`                         |                                               |
| `/tiktok/user/:user`                 | none                                               |                                               |
| `/youtube/channel/:id`               | none                                               |                                               |
| `/youtube/user/:handle`              | none                                               |                                               |
| `/youtube/playlist/:id`              | none                                               |                                               |
| `/youtube/community/:handle`         | none                                               |                                               |

Errors are `{"error":{"message":"..."}}`: 400 bad parameter or header, 401 wrong key, 404 not found, 429 platform rate limit, 502 platform failure, 503 credential missing/expired/blocked.

## Example values for env and credentials

All values below are fake.

```bash
# Process env
ACCESS_KEY=replace-with-a-long-random-string   # required
PORT=3000
CACHE_TTL=300        # seconds a finished feed is cached
CONTENT_TTL=3600     # seconds details (user ids, tokens, ...) are cached
```

| Key                  | Example value                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `TWITTER_AUTH_TOKEN` | `0a1b2c3d4e5f60718293a4b5c6d7e8f901234567` (only the value of the `auth_token` cookie from x.com)    |
| `INSTAGRAM_COOKIE`   | `sessionid=12345678%3AAbCdEf%3A5; csrftoken=AbCdEfGh123; ds_user_id=12345678`                       |
| `FACEBOOK_COOKIE`    | `c_user=100012345678901; xs=12%3AAbCdEf%3A2%3A1712345678%3A-1%3A-1; datr=AbCdEfGhIjKl`               |
| `PROXY_URI`          | `socks5h://user:pass@127.0.0.1:1080` or `http://user:pass@proxy.example.com:8080`                   |

Example request per credential:

```bash
# Twitter + proxy
curl -H 'Authorization: Bearer replace-with-a-long-random-string' \
     -H 'X-Rssgate-Config: {"TWITTER_AUTH_TOKEN":"0a1b2c3d4e5f60718293a4b5c6d7e8f901234567","PROXY_URI":"socks5h://user:pass@127.0.0.1:1080"}' \
     'http://localhost:3000/twitter/user/jack?limit=10'

# Instagram, private account
curl -H 'Authorization: Bearer replace-with-a-long-random-string' \
     -H 'X-Rssgate-Config: {"INSTAGRAM_COOKIE":"sessionid=12345678%3AAbCdEf%3A5; csrftoken=AbCdEfGh123"}' \
     'http://localhost:3000/instagram/user/someprivateuser'

# Facebook
curl -H 'Authorization: Bearer replace-with-a-long-random-string' \
     -H 'X-Rssgate-Config: {"FACEBOOK_COOKIE":"c_user=100012345678901; xs=12%3AAbCdEf%3A2%3A1712345678%3A-1%3A-1; datr=AbCdEfGhIjKl"}' \
     'http://localhost:3000/facebook/page/Meta'
```

Notes:

- `PROXY_URI` accepts the protocols `http`, `https`, `socks5` and `socks5h`.
- Instagram and Facebook cookies are sent exactly like the browser `Cookie` header: `name=value` pairs separated by `; `. The easiest way to get them is to copy the header from the Network tab of DevTools.
- Instagram needs `sessionid` (and `csrftoken` when present). Facebook needs `c_user` and `xs`.
- Inside JSON, quotes within a value must be escaped. Leave `%3A` as it is.
- Threads, TikTok and YouTube need no credentials, only `PROXY_URI` applies to them.

## Develop

```bash
bun install
bun test
bunx tsc --noEmit
scripts/check-upstream.sh   # RSSHub fixes to adopt (clones the official repo into ~/.cache/rssgate)
```

Layout: `src/platforms/*` scrape one platform each, `src/routes/*` map URLs to them, `src/{context,cache,http,feed}.ts` are the shared parts.
A GitHub Action (`.github/workflows/upstream.yml`) runs the same check every Monday and opens or updates an issue when RSSHub changed a ported file.
Platforms change often; when a feed breaks, compare with the RSSHub files in `UPSTREAM.md` first.

## License

AGPL-3.0, see `LICENSE`. The scraping logic is derived from [RSSHub](https://github.com/DIYgod/RSSHub) (AGPL-3.0), see `UPSTREAM.md` for the mapping.
