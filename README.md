# rssgate

A small service that returns feeds (JSON Feed 1.1) of Twitter/X, Instagram, Threads, Facebook, TikTok and YouTube for a backend of your own.
Credentials and a proxy travel with each request. The scraping logic is ported from [RSSHub](https://github.com/DIYgod/RSSHub), see `UPSTREAM.md`.

## Run

```bash
docker build -t rssgate .
docker run -d -p 3000:3000 -e ACCESS_KEY=change-me rssgate
# or without Docker: bun install && ACCESS_KEY=change-me bun src/index.ts
```

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

## Contoh nilai env dan kredensial

Semua nilai di bawah palsu.

```bash
# Env proses
ACCESS_KEY=ganti-dengan-string-acak-panjang   # wajib
PORT=3000
CACHE_TTL=300        # detik, cache feed utuh
CONTENT_TTL=3600     # detik, cache detail (id user, token, dll)
```

| Key                  | Contoh nilai                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `TWITTER_AUTH_TOKEN` | `0a1b2c3d4e5f60718293a4b5c6d7e8f901234567` (hanya nilai cookie `auth_token` dari x.com)                       |
| `INSTAGRAM_COOKIE`   | `sessionid=12345678%3AAbCdEf%3A5; csrftoken=AbCdEfGh123; ds_user_id=12345678`                                |
| `FACEBOOK_COOKIE`    | `c_user=100012345678901; xs=12%3AAbCdEf%3A2%3A1712345678%3A-1%3A-1; datr=AbCdEfGhIjKl`                        |
| `PROXY_URI`          | `socks5h://user:pass@127.0.0.1:1080` atau `http://user:pass@proxy.example.com:8080`                           |

Contoh request per kredensial:

```bash
# Twitter + proxy
curl -H 'Authorization: Bearer ganti-dengan-string-acak-panjang' \
     -H 'X-Rssgate-Config: {"TWITTER_AUTH_TOKEN":"0a1b2c3d4e5f60718293a4b5c6d7e8f901234567","PROXY_URI":"socks5h://user:pass@127.0.0.1:1080"}' \
     'http://localhost:3000/twitter/user/jack?limit=10'

# Instagram akun privat
curl -H 'Authorization: Bearer ganti-dengan-string-acak-panjang' \
     -H 'X-Rssgate-Config: {"INSTAGRAM_COOKIE":"sessionid=12345678%3AAbCdEf%3A5; csrftoken=AbCdEfGh123"}' \
     'http://localhost:3000/instagram/user/someprivateuser'

# Facebook
curl -H 'Authorization: Bearer ganti-dengan-string-acak-panjang' \
     -H 'X-Rssgate-Config: {"FACEBOOK_COOKIE":"c_user=100012345678901; xs=12%3AAbCdEf%3A2%3A1712345678%3A-1%3A-1; datr=AbCdEfGhIjKl"}' \
     'http://localhost:3000/facebook/page/Meta'
```

Catatan:

- `PROXY_URI` menerima protokol `http`, `https`, `socks5` dan `socks5h`.
- Cookie Instagram dan Facebook dikirim persis seperti header `Cookie` di browser: pasangan `nama=nilai` dipisah `; `. Paling mudah disalin dari tab Network di DevTools.
- Instagram butuh `sessionid` (dan `csrftoken` bila ada). Facebook butuh `c_user` dan `xs`.
- Di JSON, tanda kutip di dalam nilai harus di-escape. `%3A` dibiarkan apa adanya.
- Threads, TikTok dan YouTube tidak butuh kredensial, hanya `PROXY_URI` yang berlaku.

## Develop

```bash
bun install
bun test
bunx tsc --noEmit
RSSHUB_DIR=/path/to/RSSHub scripts/check-upstream.sh   # RSSHub fixes to adopt
```

Layout: `src/platforms/*` scrape one platform each, `src/routes/*` map URLs to them, `src/{context,cache,http,feed}.ts` are the shared parts.
Platforms change often; when a feed breaks, compare with the RSSHub files in `UPSTREAM.md` first.
