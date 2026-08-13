# Spec

No active spec. See `docs/documents/token-blacklist.md` (+ `docs/documents/token-blacklist-techstack.md`)
and `docs/documents/auth.md` for the completed Refresh Token Blacklist & Logout feature — refresh
tokens now carry a `jti`, revocations persist in Postgres (optionally mirrored to Redis behind
`REDIS_ENABLED`), and both `/auth/logout` and `/auth/refresh` (rotation) write to it, making refresh
tokens single-use and logout actually revoke server-side state.
