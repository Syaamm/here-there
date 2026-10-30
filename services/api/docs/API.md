# HERE & THERE API

Version 0.1.0. Generated from `openapi.json` by `npm run docs`: do not edit by hand.

The shared backend for **HERE.** (activities happening soon) and **THERE.** (trips and travel buddies), used by the mobile app and the admin console. One account and one verification serve both products.

### Conventions
- **Sign-in.** Send `Authorization: Bearer <token>` from `POST /v1/auth/login`, `/v1/auth/register/confirm` or `/v1/auth/guest`. The token is short-lived (15 minutes, `expiresIn` says); sign-in also returns a `refreshToken` (30 days) that is sent only to `POST /v1/auth/refresh` for a new pair, and an old refresh token never works twice. `POST /v1/me/sessions/logout-all` ends every sign-in at once. Routes marked public need no token. Authorization is decided on the server from live data on every call (suspension, role, verification and chat membership take effect immediately).
- **Verified adults only.** Creating or joining activities, creating or applying to trips, and chat need a verified adult. Routes that need it are marked, and fail with `VERIFICATION_REQUIRED` otherwise. Browsing needs no verification.
- **Errors.** Every failure has the same body, `{ "statusCode", "code", "message", "details"? }`. Branch on `code`, never on `message`. The full list, with what each means and what a client should do, is in the *Error codes* section below and in `ERROR-CODES.md`.
- **Paging.** List routes that return pages answer `{ items, nextCursor }`. Send `nextCursor` back as `cursor` for the next page; `null` means the last page. Treat the cursor as opaque.
- **Safe retries.** Send an `Idempotency-Key` header (8 to 100 characters, unique per action, the same for a retry of that action) on any write. The first answer is kept for 24 hours and a repeat with the same key gets that same answer back with `Idempotent-Replayed: true`, without doing the thing twice. The same key for a different request is refused (`IDEMPOTENCY_KEY_REUSED`); while the first try is still running the answer is `REQUEST_IN_PROGRESS`. Failed requests are not kept.
- **Caching.** `GET` answers carry an `ETag`; send `If-None-Match` to get an empty `304` when nothing changed.
- **Limits.** Sensitive and spam-prone routes are rate limited and answer `429 RATE_LIMITED`.
- **Live updates.** A WebSocket at `/v1/live` (first message carries the token) pushes chat messages and change signals. It is not part of this document.

Request bodies and query strings are generated from the same validation rules the server enforces. Responses are described in words.

## Contents

- [Shared links](#shared-links) (4)
- [HERE activities](#here-activities) (30)
- [Admin console](#admin-console) (43)
- [Sign-in and account](#sign-in-and-account) (32)
- [Safety, blocks and follows](#safety-blocks-and-follows) (9)
- [Chat and date polls](#chat-and-date-polls) (7)
- [Profile and photo](#profile-and-photo) (15)
- [THERE trips](#there-trips) (32)
- [Notifications and push](#notifications-and-push) (8)
- [Identity verification](#identity-verification) (6)
- [API description](#api-description) (1)
- [Error codes](#error-codes)

## Shared links

### `GET /.well-known/apple-app-site-association`

**Tells iPhones which links open the app (Universal Links)**

Access: public (no token needed).

Public. Apple reads it when the app is installed or updated.

Responses

- **200**: JSON, or 404 until APPLE_TEAM_ID is set

### `GET /.well-known/assetlinks.json`

**Tells Android which links open the app (App Links)**

Access: public (no token needed).

Public. Google checks it when the app is installed.

Responses

- **200**: JSON, or 404 until ANDROID_CERT_SHA256 is set

### `GET /a/{id}`

**A shared activity link: sends people to the app, or to the App Store / Google Play**

Access: public (no token needed).

Public. Where the app is installed the phone opens the app on this link and never loads the page (iOS Universal Links, Android App Links).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: A web page (HTML), not JSON. It shows only the title, the day and the city, and only for a public plan that is still on; anything else gets the same page with a 404 status. On an iPhone or an Android phone it moves on to the store by itself.
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /t/{id}`

**A shared trip link: sends people to the app, or to the App Store / Google Play**

Access: public (no token needed).

Public. Works like /a/{id}.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: A web page (HTML), not JSON. It shows only the title, the destination and the dates, and only for a trip that is still open; anything else gets the same page with a 404 status.
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

## HERE activities

### `GET /v1/activities`

**Discover activities (filters, distance, ranking)**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `city` | query | string | no |  |
| `category` | query | one of: `coffee`, `drinks`, `food`, `sports`, `culture` | no |  |
| `from` | query | string (date-time) | no |  |
| `to` | query | string (date-time) | no |  |
| `lat` | query | number (-90 to 90) | no |  |
| `lng` | query | number (-180 to 180) | no |  |
| `radiusKm` | query | number (0.1 to 100) | no |  |
| `hasSpots` | query | one of: `true`, `false` | no |  |
| `sort` | query | one of: `time`, `relevance` | no | default `"time"` |
| `cursor` | query | string | no |  |
| `limit` | query | number (1 to 50) | no | default `20` |

Responses

- **200**: A page: { items, nextCursor } (nextCursor is null on the last page).
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/activities`

**Create an activity**

Access: signed in (`Authorization: Bearer <token>`).

Needs a **verified adult**.

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string (2 to 80 characters) | yes |  |
| `category` | one of: `coffee`, `drinks`, `food`, `sports`, `culture` | yes |  |
| `tags` | array of string (1 to 24 characters) | no | default `[]` |
| `description` | string (0 to 1000 characters) | no |  |
| `city` | string (2 to 60 characters) | yes |  |
| `venueName` | string (2 to 120 characters) | yes |  |
| `venuePlaceId` | string (0 to 200 characters) | no |  |
| `lat` | number (-90 to 90) | no |  |
| `lng` | number (-180 to 180) | no |  |
| `startsAt` | string (date-time) | yes |  |
| `endsAt` | string (date-time) | yes |  |
| `capacity` | integer (2 to 20) | yes |  |
| `visibility` | one of: `public`, `invite_only` | no | default `"public"` |
| `joinPolicy` | one of: `host_approval`, `instant` | no | default `"host_approval"` |
| `language` | string (0 to 20 characters) | no |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `CONTENT_REJECTED`, `INVALID_SCHEDULE`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `VERIFICATION_REQUIRED`
- **409**: Conflicts with the current state. Codes: `DUPLICATE_ACTIVITY`, `TOO_MANY_OPEN_ACTIVITIES`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/activities/{id}`

**Activity detail, with my own status (member, requested, waitlisted...)**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `PATCH /v1/activities/{id}`

**Edit an activity (material changes notify members and ask them to reconfirm)**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string (2 to 80 characters) | no |  |
| `description` | string (0 to 1000 characters) | no |  |
| `venueName` | string (2 to 120 characters) | no |  |
| `venuePlaceId` | string (0 to 200 characters) | no |  |
| `lat` | number (-90 to 90) | no |  |
| `lng` | number (-180 to 180) | no |  |
| `startsAt` | string (date-time) | no |  |
| `endsAt` | string (date-time) | no |  |
| `capacity` | integer (2 to 20) | no |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `CONTENT_REJECTED`, `INVALID_SCHEDULE`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_HOST`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `ACTIVITY_CLOSED`, `CAPACITY_BELOW_MEMBERS`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/activities/{id}/appeal`

**Ask the host to look again at a declined request (once)**

Access: signed in (`Authorization: Bearer <token>`).

Needs a **verified adult**.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `intro` | string (0 to 500 characters) | no |  |

Responses

- **200**: { id, state }: back to the host as a new request, or the waiting list if it filled up.
- **400**: The request is not acceptable. Codes: `CONTENT_REJECTED`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `VERIFICATION_REQUIRED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `ACTIVITY_CLOSED`, `ALREADY_APPEALED`, `NOT_DECLINED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/activities/{id}/attendance`

**Say whether I attended (voluntary, about myself)**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `attended` | boolean | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `ATTENDANCE_CLOSED`, `NOT_FINISHED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/activities/{id}/cancel`

**Cancel an activity (members are told)**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_HOST`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `ACTIVITY_FINISHED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `DELETE /v1/activities/{id}/favorite`

**Remove an activity from favourites**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/activities/{id}/favorite`

**Save an activity to favourites**

Access: signed in (`Authorization: Bearer <token>`).

Refused (ACTIVITY_CLOSED) once the activity is cancelled or has started. Removing a favourite is always allowed.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `ACTIVITY_CLOSED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `DELETE /v1/activities/{id}/handover`

**Withdraw a hosting offer**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_HOST`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/activities/{id}/handover`

**Offer hosting to a member (they must accept)**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `userId` | string (1 or more characters) | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_HOST`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `NOT_VERIFIED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/activities/{id}/handover/answer`

**Accept or decline an offer to take over hosting**

Access: signed in (`Authorization: Bearer <token>`).

Needs a **verified adult**.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `accept` | boolean | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `VERIFICATION_REQUIRED`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/activities/{id}/host-no-show`

**Member: say the host did not show up (from 30 minutes after the start until 72 hours after the end)**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `note` | string (0 to 1000 characters) | no |  |

Responses

- **200**: { id, status, priority, expectedWithin, coverage, emergency }. It becomes a report that a moderator decides; saying it twice returns the same report.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `HOST_ABSENT_TOO_EARLY`, `HOST_ABSENT_WINDOW_CLOSED`, `PLAN_CANCELLED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/activities/{id}/leave`

**Leave an activity (chat access ends at once)**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `HOST_CANNOT_LEAVE`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `DELETE /v1/activities/{id}/members/{userId}`

**Host removes a member (chat access ends at once)**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |
| `userId` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_HOST`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `CANNOT_REMOVE_HOST`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/activities/{id}/no-shows`

**Host: who was approved and any note already made**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: { canMark, markableFrom, markableUntil, items }
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/activities/{id}/no-shows`

**Host: say a member did not come (from the start until 48 hours after the end)**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `userId` | string (1 or more characters) | yes |  |

Responses

- **200**: { id, state }. The member is told and can dispute for 7 days; it only counts once confirmed.
- **400**: The request is not acceptable. Codes: `INVALID_TARGET`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `MARK_NOT_OPEN`, `MARK_WINDOW_CLOSED`, `PLAN_CANCELLED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `DELETE /v1/activities/{id}/no-shows/{userId}`

**Host: take a note back while it is still just a note**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |
| `userId` | path | string | yes |  |

Responses

- **200**: { ok: true }
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `MARK_LOCKED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/activities/{id}/reconfirm`

**Confirm I still come after a material change**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/activities/{id}/requests`

**The host's join requests, a page at a time: waiting for an answer first, then the waiting list, approved, declined, withdrawn**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: A page: { items, nextCursor } (nextCursor is null on the last page). Also { pending }: how many wait for an answer in all, not only on this page.
- **400**: The request is not acceptable. Codes: `INVALID_CURSOR`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_HOST`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/activities/{id}/requests`

**Ask to join (goes on the waiting list when full)**

Access: signed in (`Authorization: Bearer <token>`).

Needs a **verified adult**.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `intro` | string (0 to 500 characters) | no |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `BLOCKED`, `INVITE_ONLY`, `VERIFICATION_REQUIRED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `ACTIVITY_CANCELLED`, `ACTIVITY_FINISHED`, `ALREADY_REQUESTED`, `IS_HOST`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/activities/{id}/requests/{requestId}/decision`

**Host approves or declines a request**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |
| `requestId` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `decision` | one of: `approve`, `decline` | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_HOST`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `ACTIVITY_FULL`, `APPLICANT_UNAVAILABLE`, `REQUEST_WITHDRAWN`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `DELETE /v1/activities/{id}/requests/mine`

**Withdraw my request**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/me/activities`

**Everything I host, go to, or have requested**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/me/activities/overlapping`

**My plans that overlap a time window**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/me/activities/page`

**My activities by tab, paged**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: A page: { items, nextCursor } (nextCursor is null on the last page).
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/me/activities/soon`

**My plans on now or starting within a few hours (Home "Next up")**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/me/favorites`

**My favourite activities**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: A page: { items, nextCursor } (nextCursor is null on the last page).
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/places/search`

**Search for a real place by name or address (for the meeting location)**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `q` | query | string (3 to 100 characters) | yes |  |
| `city` | query | string (0 to 80 characters) | no |  |

Responses

- **200**: { items: [{ id, name, address, lat, lng }] }, up to 6, best match first. Answers are cached for 10 minutes.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`
- **502**: Error. Codes: `PLACES_UNAVAILABLE`

### `GET /v1/regions/limits`

**How far ahead a plan may be made from a city**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `city` | query | string (0 to 80 characters) | no |  |

Responses

- **200**: { city, region, here: { months, latest, text, setBy }, there: { months, latest, text, setBy } }. here is for an activity in that city, there for a trip that starts from it. latest is the last moment a plan may start. setBy names the place whose admin set the limit (null for the built-in default). Without a city: the whole service's setting.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

## Admin console

### `GET /v1/admin/activities`

**HERE activities for moderation**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: support, moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `status` | query | string | no |  |
| `limit` | query | string | no |  |
| `cursor` | query | string | no |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`

### `POST /v1/admin/activities/{id}/members/{userId}/remove`

**Remove a member from an activity (access ends at once)**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |
| `userId` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`
- **404**: Not found. Codes: `NOT_FOUND`

### `POST /v1/admin/activities/{id}/remove`

**Remove an activity (members are told it was cancelled)**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `reason` | string (3 to 500 characters) | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`
- **404**: Not found. Codes: `NOT_FOUND`

### `GET /v1/admin/appeals`

**Appeals waiting for a decision (or decided: state=upheld|rejected)**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `state` | query | string | no |  |
| `limit` | query | string | no |  |
| `cursor` | query | string | no |  |

Responses

- **200**: { items }
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`

### `POST /v1/admin/appeals/{id}/decision`

**Accept (uphold) or reject an appeal, with a note the person sees**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `decision` | one of: `uphold`, `reject` | yes |  |
| `note` | string (3 to 500 characters) | yes |  |

Responses

- **200**: { id, state }. Upholding undoes the decision: verified again, account restored, or listing put back.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `ADMIN_ONLY`, `FORBIDDEN`, `OWN_APPEAL`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `APPEAL_DECIDED`, `NOT_REJECTED`

### `GET /v1/admin/audit`

**Read-only history of staff and safety actions**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `objectType` | query | string | no |  |
| `objectId` | query | string | no |  |
| `limit` | query | string | no |  |
| `cursor` | query | string | no |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`

### `GET /v1/admin/health`

**How the service is doing right now: per-minute counters, error rate, slow database calls (table and action, with the request id)**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: support, moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `minutes` | query | string | no |  |

Responses

- **200**: { status (ok | degraded), errorRate5m, errorRate60m, totals, lastMinute, series: [{ at, requests, errors, clientErrors, slowRequests, slowQueries, signups, joins, messages, p95Ms }], slowQueries: [{ at, ms, what, reqId }], database: { pingMs }, errorTracking, uptimeSeconds }. Counted by this server only.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`

### `GET /v1/admin/messages/{id}`

**A reported message with the messages around it**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: support, moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: { id, body, state, sender, scope, around }
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`
- **404**: Not found. Codes: `NOT_FOUND`

### `POST /v1/admin/messages/{id}/remove`

**Hide a message from its chat (kept for the record). The sender is told why**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `reason` | string (3 to 500 characters) | yes |  |

Responses

- **200**: { ok, state }. Open reports about the message are resolved.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`
- **404**: Not found. Codes: `NOT_FOUND`

### `POST /v1/admin/messages/{id}/restore`

**Put a hidden message back**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: { ok, state }
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`
- **404**: Not found. Codes: `NOT_FOUND`

### `GET /v1/admin/no-shows`

**No-show notes waiting for a moderator (disputed and pending)**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: support, moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `state` | query | string | no |  |

Responses

- **200**: { items }
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`

### `POST /v1/admin/no-shows/{markId}/decision`

**Uphold or overturn a no-show note (any note, to fix mistakes)**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `markId` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `decision` | one of: `uphold`, `overturn` | yes |  |
| `note` | string (3 to 500 characters) | yes |  |

Responses

- **200**: { id, state }. Both people are told.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`
- **404**: Not found. Codes: `NOT_FOUND`

### `GET /v1/admin/no-shows/hosts`

**Hosts who say many people did not come, or whose notes keep being overturned**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: support, moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `all` | query | string | no |  |

Responses

- **200**: { rule, items: [{ hostId, name, flag, reasons, marks, attendees, decided, overturned }] }. Only the unusual ones unless all=true. It never acts by itself: moderators are told once a month per host.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`

### `GET /v1/admin/oncall`

**Who is on call for urgent reports, the coming shifts, and what happens when nobody answers**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: support, moderator, trust_lead, admin.

Responses

- **200**: { now, fallback, shifts, steps, ownerContactSet }. With no shift covering now, the trust leads and administrators are on call.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`

### `POST /v1/admin/oncall`

**Add an on-call shift (administrators only)**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: admin.

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `userId` | string (1 or more characters) | yes |  |
| `startsAt` | string (date-time) | yes |  |
| `endsAt` | string (date-time) | yes |  |
| `note` | string (0 to 200 characters) | no |  |

Responses

- **200**: { id }
- **400**: The request is not acceptable. Codes: `INVALID_SHIFT`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`

### `DELETE /v1/admin/oncall/{id}`

**Remove an on-call shift (administrators only)**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: { ok }
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`
- **404**: Not found. Codes: `NOT_FOUND`

### `GET /v1/admin/overview`

**Everything the Overview dashboard shows**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: support, moderator, trust_lead, admin.

Responses

- **200**: Counters (users, pending checks, open reports, active plans), real-member totals, identity approval rate, report counts by status, and the last 30 days as daily series (members, activities, trips, reports) with the previous 30 days for comparison, plus reports by category.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`

### `GET /v1/admin/regions`

**The places (whole service, countries, regions, cities) with their planning limits**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: support, moderator, trust_lead, admin.

Responses

- **200**: { scope, defaults: { here, there }, ranges, items: [{ key, name, kind, parentKey, cityKey, hereMonths, thereMonths, effective: { here, hereFrom, there, thereFrom }, children, staff, canEdit, canDelete }] }. hereMonths and thereMonths are what the place itself sets (null = follows the place above); effective is what applies. Staff of one area see only their own place and what is under it.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`

### `POST /v1/admin/regions`

**Add a country, region or city under a place you look after (administrators)**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: admin.

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string (2 to 60 characters) | yes |  |
| `kind` | one of: `country`, `region`, `city` | yes |  |
| `parentKey` | string (1 to 60 characters) | no |  |
| `key` | string (2 to 40 characters) | no |  |
| `cityKey` | string (2 to 60 characters) | no |  |
| `hereMonths` | integer (1 to 12) or null | no |  |
| `thereMonths` | integer (1 to 24) or null | no |  |

Responses

- **200**: { key }
- **400**: The request is not acceptable. Codes: `INVALID_PLACE`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`, `OUT_OF_SCOPE`
- **409**: Conflicts with the current state. Codes: `CITY_ALREADY_ASSIGNED`

### `DELETE /v1/admin/regions/{key}`

**Remove a place that has nothing under it and no staff (administrators)**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `key` | path | string | yes |  |

Responses

- **200**: { ok }
- **400**: The request is not acceptable. Codes: `INVALID_PLACE`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`, `OUT_OF_SCOPE`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `PLACE_HAS_STAFF`, `PLACE_NOT_EMPTY`

### `PATCH /v1/admin/regions/{key}`

**Change a place's name or its planning limits: HERE months (1 to 12) and THERE months (1 to 24); null = follow the place above (administrators)**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `key` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string (2 to 60 characters) | no |  |
| `hereMonths` | integer (1 to 12) or null | no |  |
| `thereMonths` | integer (1 to 24) or null | no |  |

Responses

- **200**: { key }
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`, `OUT_OF_SCOPE`
- **404**: Not found. Codes: `NOT_FOUND`

### `GET /v1/admin/regions/unassigned`

**City names people have used that no place covers yet (whole-service staff only)**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: support, moderator, trust_lead, admin.

Responses

- **200**: { items: [{ cityKey, uses }] }, most used first
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`

### `GET /v1/admin/reports`

**The report queue: urgent first, then overdue and escalated**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: support, moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `status` | query | string | no |  |
| `category` | query | string | no |  |

Responses

- **200**: { items }. Each has priority, ageHours, overdue, escalated, assignedName, subject (the person it is about), message (for message reports) and repeatOffender: { flag, reasons }.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`

### `POST /v1/admin/reports/{id}/assign`

**Take a report**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`
- **404**: Not found. Codes: `NOT_FOUND`

### `POST /v1/admin/reports/{id}/resolve`

**Resolve, dismiss or mark a report in review**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `status` | one of: `resolved`, `dismissed`, `in_review` | yes |  |
| `resolution` | string (0 to 1000 characters) | no |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`
- **404**: Not found. Codes: `NOT_FOUND`

### `GET /v1/admin/reports/workload`

**Moderator workload and queue health**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: support, moderator, trust_lead, admin.

Responses

- **200**: { policy, queue: { unassigned, urgent, overdue, oldestUnassignedHours }, moderators: [{ id, name, role, assigned, overdue, oldestHours, resolvedLast7Days }] }
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`

### `GET /v1/admin/scope`

**Which part of the service this staff account looks after**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: support, moderator, trust_lead, admin.

Responses

- **200**: { role, scope: null | { key, name, kind } }. null means the whole service; otherwise one city, region or country.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`

### `GET /v1/admin/trips`

**THERE trips for moderation**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: support, moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `status` | query | string | no |  |
| `limit` | query | string | no |  |
| `cursor` | query | string | no |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`

### `POST /v1/admin/trips/{id}/remove`

**Remove a trip (members are told it was cancelled)**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `reason` | string (3 to 500 characters) | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`
- **404**: Not found. Codes: `NOT_FOUND`

### `GET /v1/admin/users`

**Search people**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: support, moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `q` | query | string | no |  |
| `state` | query | one of: `active`, `suspended` | no |  |
| `limit` | query | string | no |  |
| `cursor` | query | string | no |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`

### `GET /v1/admin/users/{id}`

**One person: status, history and every report about them**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: support, moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`
- **404**: Not found. Codes: `NOT_FOUND`

### `POST /v1/admin/users/{id}/mfa/reset`

**Switch off a staff member two-step sign-in (a lost phone); admin only**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `reason` | string (3 to 500 characters) | yes |  |

Responses

- **200**: { ok: true }. They set it up again at their next sign-in.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`
- **404**: Not found. Codes: `NOT_FOUND`

### `GET /v1/admin/users/{id}/offender`

**Repeat-offender check for a person**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: support, moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: { flag, reasons, warnings, reporters, suspensions }
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`
- **404**: Not found. Codes: `NOT_FOUND`

### `POST /v1/admin/users/{id}/overturn-rejection`

**Approve a wrongly rejected person (under-18 results: admin only)**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `note` | string (3 to 500 characters) | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `ADMIN_ONLY`, `FORBIDDEN`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `NOT_REJECTED`

### `GET /v1/admin/users/{id}/reliability`

**Everything behind a person level: events, weights, notes and level history**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: support, moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: { level, summary, penalties, events, marks, changes }
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`
- **404**: Not found. Codes: `NOT_FOUND`

### `POST /v1/admin/users/{id}/require-reverification`

**Require a new identity check (security or fraud)**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `reason` | one of: `security`, `fraud_suspected`, `other` | yes |  |
| `note` | string (3 to 500 characters) | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `ALREADY_VERIFIED`

### `POST /v1/admin/users/{id}/reset-verification`

**Let a person try verification again**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `note` | string (3 to 500 characters) | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`
- **404**: Not found. Codes: `NOT_FOUND`

### `POST /v1/admin/users/{id}/restore`

**Lift a suspension**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `reason` | string (3 to 500 characters) | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`
- **404**: Not found. Codes: `NOT_FOUND`

### `POST /v1/admin/users/{id}/role`

**Change a person's staff role, and the area they look after (whole-service administrators only)**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `role` | one of: `user`, `support`, `moderator`, `trust_lead`, `admin` | yes |  |
| `regionKey` | string (1 to 60 characters) or null | no |  |

Responses

- **200**: { role, regionKey }. regionKey limits a staff account to one city, region or country and everything under it; leave it out for the whole service.
- **400**: The request is not acceptable. Codes: `INVALID_PLACE`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `ADMIN_ONLY`, `FORBIDDEN`, `GLOBAL_STAFF_ONLY`
- **404**: Not found. Codes: `NOT_FOUND`

### `POST /v1/admin/users/{id}/suspend`

**Suspend (timed, or until restored); open reports about them resolve automatically**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `reason` | string (3 to 500 characters) | yes |  |
| `days` | integer (1 to 365) | no |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `INVALID_TARGET`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`
- **404**: Not found. Codes: `NOT_FOUND`

### `POST /v1/admin/users/{id}/warn`

**Send a formal warning (can be tied to a report or message)**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `reason` | string (5 to 500 characters) | yes |  |
| `reportId` | string | no |  |
| `messageId` | string | no |  |

Responses

- **200**: { id, warningsInLastSixMonths, repeatOffender }. The person is told and can appeal it once.
- **400**: The request is not acceptable. Codes: `INVALID_TARGET`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`
- **404**: Not found. Codes: `NOT_FOUND`

### `GET /v1/admin/verifications`

**Identity checks by status**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: support, moderator, trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `status` | query | string | no |  |
| `limit` | query | string | no |  |
| `cursor` | query | string | no |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`

### `POST /v1/admin/verifications/{id}/decision`

**Approve or reject a manual identity check**

Access: signed in (`Authorization: Bearer <token>`).

Staff only. Roles: trust_lead, admin.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `decision` | one of: `verified`, `rejected` | yes |  |
| `reason` | one of: `document`, `liveness`, `underage`, `other` | no |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `FORBIDDEN`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `ALREADY_DECIDED`

## Sign-in and account

### `POST /v1/appeals/suspension`

**Appeal a suspension (the person cannot sign in, so email and password are sent)**

Access: public (no token needed).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `email` | string (email) | yes |  |
| `password` | string | yes |  |
| `message` | string (10 to 1000 characters) | yes |  |

Responses

- **200**: { id, state: "open" }. The answer comes by email. Once every 30 days.
- **400**: The request is not acceptable. Codes: `CONTENT_REJECTED`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_CREDENTIALS`
- **409**: Conflicts with the current state. Codes: `ALREADY_APPEALED`, `APPEAL_OPEN`, `NOTHING_TO_APPEAL`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/auth/guest`

**Start a read-only "explore" session without an account (24 hours)**

Access: public (no token needed).

Responses

- **200**: { token, user }; every non-GET call afterwards fails with GUEST_READ_ONLY.
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/auth/login`

**Sign in with email and password**

Access: public (no token needed).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `email` | string | yes |  |
| `password` | string (1 or more characters) | yes |  |

Responses

- **200**: { token, refreshToken, expiresIn, user }, or { mfaRequired, mfaToken } for staff. An unknown address and a wrong password give the same answer and take the same time.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_CREDENTIALS`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/auth/logout`

**Sign out of this device**

Access: signed in (`Authorization: Bearer <token>`).

Optional body: { refreshToken }.

Responses

- **200**: { ok: true }. This sign-in cannot be refreshed any more; its access token ends within 15 minutes.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/auth/mfa/verify`

**Finish a two-step sign-in with the code**

Access: public (no token needed).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `mfaToken` | string (10 or more characters) | yes |  |
| `code` | string (6 to 20 characters) | yes |  |

Responses

- **200**: { token, usedRecoveryCode, user }. mfaToken is the short-lived pass returned by the password step.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_MFA_CODE`, `MFA_EXPIRED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/auth/password/forgot`

**Email a password-reset code**

Access: public (no token needed).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `email` | string | yes |  |

Responses

- **200**: { ok: true } whether or not the address exists (no account probing).
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/auth/password/reset`

**Set a new password with the emailed code**

Access: public (no token needed).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `email` | string | yes |  |
| `code` | string | yes |  |
| `newPassword` | string (10 to 200 characters) | yes |  |

Responses

- **200**: { ok: true }. Every earlier sign-in stops working.
- **400**: The request is not acceptable. Codes: `INVALID_CODE`, `TOO_MANY_ATTEMPTS`, `VALIDATION_FAILED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/auth/refresh`

**Swap a refresh token for a new pair of tokens**

Access: public (no token needed).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `refreshToken` | string (10 to 100 characters) | yes |  |

Responses

- **200**: { token, refreshToken, expiresIn }. The old refresh token stops working; showing an old one again later ends that whole sign-in.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_REFRESH_TOKEN`, `REFRESH_TOKEN_REUSED`
- **409**: Conflicts with the current state. Codes: `REFRESH_IN_PROGRESS`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/auth/register`

**Create an account (18+ confirmation required)**

Access: public (no token needed).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `email` | string | yes |  |
| `password` | string (10 to 200 characters) | yes |  |
| `displayName` | string (2 to 40 characters) | yes |  |
| `homeCity` | string (0 to 60 characters) | no |  |
| `adultConfirmed` | `true` | yes |  |

Responses

- **200**: { pending: true, email, ticket }, the same whether or not the address already has an account (so it cannot be used to find out who is a member). A new address gets its account and a 6-digit email code (in development echoed back as devCode); a known address gets an email saying so and a ticket that matches nothing. Finish with /v1/auth/register/confirm.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **403**: Not allowed. Codes: `REGISTRATION_BLOCKED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/auth/register/confirm`

**Finish signing up with the emailed code**

Access: public (no token needed).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `email` | string | yes |  |
| `code` | string | yes |  |
| `ticket` | string (10 to 100 characters) | yes |  |

Responses

- **200**: { token, refreshToken, expiresIn, user }. The code and the ticket from the sign-up step confirm the address and sign the person in.
- **400**: The request is not acceptable. Codes: `INVALID_CODE`, `VALIDATION_FAILED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/auth/register/resend`

**Send the sign-up code again**

Access: public (no token needed).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `email` | string | yes |  |
| `ticket` | string (10 to 100 characters) | yes |  |

Responses

- **200**: { ok: true } whatever the address or ticket.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/auth/social`

**Sign in or sign up with Apple or Google**

Access: public (no token needed).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `provider` | one of: `apple`, `google` | yes |  |
| `idToken` | string (20 to 6000 characters) | yes |  |
| `adultConfirmed` | boolean | no |  |
| `displayName` | string (2 to 40 characters) | no |  |

Responses

- **200**: { token, user } (or { mfaRequired, mfaToken } is never returned: staff cannot use this). The ID token is checked against the provider's keys. A new account needs adultConfirmed: true.
- **400**: The request is not acceptable. Codes: `ADULT_CONFIRMATION_REQUIRED`, `EMAIL_REQUIRED`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_SOCIAL_TOKEN`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `REGISTRATION_BLOCKED`, `SOCIAL_NOT_FOR_STAFF`
- **409**: Conflicts with the current state. Codes: `ACCOUNT_EXISTS`
- **503**: Error. Codes: `SOCIAL_UNAVAILABLE`

### `GET /v1/auth/social/providers`

**Which social sign-in providers are switched on**

Access: public (no token needed).

Responses

- **200**: { apple: boolean, google: boolean }

### `GET /v1/export/zip`

**The ZIP copy of my data (signed link, no login header)**

Access: public (no token needed).

Public: the signed link in the t parameter is the login. It names the person, the language and an expiry.

Responses

- **200**: The ZIP file (application/zip).
- **400**: The request is not acceptable. Codes: `INVALID_LINK`, `LINK_EXPIRED`

### `GET /v1/me`

**The signed-in person: profile, role and the three separate statuses (email, adult, identity)**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: The person. ETag supported (If-None-Match gives 304).
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/me/delete`

**Delete my account and erase my personal data (spec 9.2)**

Access: signed in (`Authorization: Bearer <token>`).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `password` | string (1 or more characters) | yes |  |
| `confirm` | `"DELETE"` | yes |  |

Responses

- **200**: { ok: true }. Open plans are cancelled or left first; messages that a report points at are kept for safety review.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`, `WRONG_PASSWORD`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `STAFF_ACCOUNT`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/me/email/change`

**Start changing the email address (code is sent to the new address)**

Access: signed in (`Authorization: Bearer <token>`).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `newEmail` | string | yes |  |
| `password` | string (1 or more characters) | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `SAME_EMAIL`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`, `WRONG_PASSWORD`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **409**: Conflicts with the current state. Codes: `EMAIL_TAKEN`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/me/email/change/confirm`

**Finish changing the email address with the code**

Access: signed in (`Authorization: Bearer <token>`).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | string | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `CODE_EXPIRED`, `INVALID_CODE`, `TOO_MANY_ATTEMPTS`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/me/email/send-code`

**Send the 6-digit email confirmation code**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: { ok: true }
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/me/email/verify`

**Confirm the email address with the code**

Access: signed in (`Authorization: Bearer <token>`).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | string | yes |  |

Responses

- **200**: { ok: true }
- **400**: The request is not acceptable. Codes: `CODE_EXPIRED`, `INVALID_CODE`, `TOO_MANY_ATTEMPTS`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/me/export/zip-link`

**A two-minute link to download a copy of my data (ZIP)**

Access: signed in (`Authorization: Bearer <token>`).

Data access right, spec 9.2.

Responses

- **200**: { url, expiresInSeconds }. Open the url to download a ZIP with my-data.json (profile, plans, messages, follows, alerts, identity-check outcomes, account activity) and a README. Limited to 1 a day. Body: { lang?: "en" | "it" }.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `DELETE /v1/me/mfa`

**Switch two-step sign-in off (not allowed for staff where it is required)**

Access: signed in (`Authorization: Bearer <token>`).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `password` | string (1 or more characters) | yes |  |
| `code` | string (6 to 20 characters) | yes |  |

Responses

- **200**: { enabled: false }
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_MFA_CODE`, `INVALID_TOKEN`, `UNAUTHENTICATED`, `WRONG_PASSWORD`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `MFA_REQUIRED`, `STAFF_ONLY`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/me/mfa`

**Where my two-step sign-in stands**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: { enabled, required, recoveryCodesLeft }
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/me/mfa/enable`

**Switch two-step sign-in on with the first code from the app**

Access: signed in (`Authorization: Bearer <token>`).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | string (6 to 20 characters) | yes |  |

Responses

- **200**: { enabled: true, recoveryCodes }: eight one-time codes, shown only now.
- **400**: The request is not acceptable. Codes: `INVALID_SETUP_CODE`, `MFA_NOT_STARTED`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `STAFF_ONLY`
- **409**: Conflicts with the current state. Codes: `MFA_ALREADY_ON`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/me/mfa/setup`

**Start two-step sign-in (staff): get the secret for an authenticator app**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: { secret, otpauthUri }. Nothing is on until a code is confirmed.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `STAFF_ONLY`
- **409**: Conflicts with the current state. Codes: `MFA_ALREADY_ON`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/me/password`

**Change the password while signed in**

Access: signed in (`Authorization: Bearer <token>`).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `currentPassword` | string (1 or more characters) | yes |  |
| `newPassword` | string (10 to 200 characters) | yes |  |

Responses

- **200**: { ok: true, token, refreshToken, expiresIn }: other devices are signed out, this one gets a fresh sign-in.
- **400**: The request is not acceptable. Codes: `SAME_PASSWORD`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`, `WRONG_PASSWORD`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `DELETE /v1/me/phone`

**Remove the mobile number**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/me/phone/send-code`

**Send an SMS code to an optional mobile number**

Access: signed in (`Authorization: Bearer <token>`).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `phone` | string | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `PHONE_BLOCKED`
- **409**: Conflicts with the current state. Codes: `PHONE_IN_USE`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/me/phone/verify`

**Confirm the mobile number with the SMS code**

Access: signed in (`Authorization: Bearer <token>`).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | string | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `CODE_EXPIRED`, `INVALID_CODE`, `TOO_MANY_ATTEMPTS`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **409**: Conflicts with the current state. Codes: `PHONE_IN_USE`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/me/sessions`

**Where this account is signed in**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: { items: [{ id, device, createdAt, lastUsedAt, current }] }
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/me/sessions/logout-all`

**Sign out of every device at once, this one included**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: { ok: true }. Every access token and refresh token of the account stops working immediately.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/retention`

**What the app keeps and for how long, in plain words (privacy information)**

Access: public (no token needed).

Responses

- **200**: { items: [{ what, kept, why }] }. Public; the periods follow the server settings.

## Safety, blocks and follows

### `GET /v1/blocks`

**People I have blocked, newest first**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: A page: { items, nextCursor } (nextCursor is null on the last page). Each item: { userId, displayName }.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/blocks`

**Block a person (works across HERE and THERE, ends any follow)**

Access: signed in (`Authorization: Bearer <token>`).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `userId` | string (1 or more characters) | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `INVALID_TARGET`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `DELETE /v1/blocks/{userId}`

**Unblock a person**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `userId` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/follows`

**Follow a person (mutual follows are buddies)**

Access: signed in (`Authorization: Bearer <token>`).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `userId` | string (1 or more characters) | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `INVALID_TARGET`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `DELETE /v1/follows/{userId}`

**Stop following a person**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `userId` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/me/connections`

**My buddies, following or followers (private lists)**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `kind` | query | one of: `buddies`, `following`, `followers` | no |  |
| `limit` | query | number (-9007199254740991 to 9007199254740991) | no |  |
| `cursor` | query | string | no |  |

Responses

- **200**: A page: { items, nextCursor } (nextCursor is null on the last page).
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/me/reports`

**Reports I made and where each stands**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: A page: { items, nextCursor } (nextCursor is null on the last page). Each item: { id, category, targetType, status, outcome, createdAt, canAppeal }, newest first. A dismissed report can be appealed once with POST /v1/me/appeals (kind report).
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/reports`

**Report a person, activity, trip or message**

Access: signed in (`Authorization: Bearer <token>`).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `targetType` | one of: `user`, `activity`, `trip`, `message` | yes |  |
| `targetId` | string (1 or more characters) | yes |  |
| `category` | one of: `harassment`, `fraud`, `inappropriate_content`, `underage`, `physical_safety`, `spam`, `financial_solicitation`, `immediate_danger`, `host_no_show` | yes |  |
| `details` | string (0 to 1000 characters) | no |  |

Responses

- **200**: { id, status, priority, expectedWithin, coverage, emergency }. Category immediate_danger and physical_safety are urgent: looked at first, and immediate danger alerts every moderator at once. The answer also carries the emergency number to show the person.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/reports/policy`

**How reports are handled: coverage hours, answer times and the emergency number**

Access: public (no token needed).

Responses

- **200**: { coverage: { text, onDutyNow }, answerWithin: { urgent, normal }, emergency: { number, text } }. Public.

## Chat and date polls

### `GET /v1/conversations/{id}/info`

**Who is in a chat and whether it is still writable**

Access: signed in (`Authorization: Bearer <token>`).

Needs a **verified adult**.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_A_MEMBER`, `VERIFICATION_REQUIRED`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/conversations/{id}/messages`

**Messages of a chat (membership is checked live on every call)**

Access: signed in (`Authorization: Bearer <token>`).

Needs a **verified adult**.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |
| `read` | query | one of: `0`, `1` | no |  |
| `limit` | query | number (1 to 100) | no |  |
| `cursor` | query | string | no |  |

Responses

- **200**: A page: { items, nextCursor } (nextCursor is null on the last page).
- **400**: The request is not acceptable. Codes: `INVALID_CURSOR`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_A_MEMBER`, `VERIFICATION_REQUIRED`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/conversations/{id}/messages`

**Send a message**

Access: signed in (`Authorization: Bearer <token>`).

Needs a **verified adult**.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `body` | string (1 to 2000 characters) | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `CONTENT_REJECTED`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_A_MEMBER`, `VERIFICATION_REQUIRED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `CONVERSATION_CLOSED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/conversations/{id}/polls`

**Organizer starts a date poll in a trip chat**

Access: signed in (`Authorization: Bearer <token>`).

Needs a **verified adult**.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string (3 to 120 characters) | yes |  |
| `dateStart` | string (date-time) | no |  |
| `dateEnd` | string (date-time) | no |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `CONTENT_REJECTED`, `NOT_A_TRIP_CHAT`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_ORGANIZER`, `VERIFICATION_REQUIRED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `TOO_MANY_OPEN_POLLS`, `TRIP_CLOSED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/me/conversations`

**My chats, newest message first**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: A page: { items, nextCursor } (nextCursor is null on the last page).
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/polls/{pollId}/close`

**Organizer closes a poll, optionally making its dates the proposed final dates**

Access: signed in (`Authorization: Bearer <token>`).

Needs a **verified adult**.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `pollId` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `adopt` | boolean | no | default `false` |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `NO_DATES`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_ORGANIZER`, `VERIFICATION_REQUIRED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `POLL_CLOSED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/polls/{pollId}/vote`

**Accept or reject the dates in a poll**

Access: signed in (`Authorization: Bearer <token>`).

Needs a **verified adult**.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `pollId` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `vote` | one of: `accept`, `reject` | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_A_MEMBER`, `VERIFICATION_REQUIRED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `POLL_CLOSED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

## Profile and photo

### `GET /v1/me/appeals`

**My appeals and what was decided, newest first**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: A page: { items, nextCursor } (nextCursor is null on the last page). Each item: { id, kind, what, state, decision, createdAt, decidedAt }.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/me/appeals`

**Ask staff to look again: a rejected identity check, a listing or message staff removed, a warning, or a report of yours that was dismissed**

Access: signed in (`Authorization: Bearer <token>`).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | one of: `verification`, `removal`, `report`, `warning`, `message` | yes |  |
| `targetType` | one of: `activity`, `trip` | no |  |
| `targetId` | string | no |  |
| `message` | string (10 to 1000 characters) | yes |  |

Responses

- **200**: { id, kind, state: "open" }. Once per decision.
- **400**: The request is not acceptable. Codes: `CONTENT_REJECTED`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **409**: Conflicts with the current state. Codes: `ALREADY_APPEALED`, `APPEAL_OPEN`, `NOTHING_TO_APPEAL`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/me/drafts`

**My saved drafts (activities and trips not yet posted)**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: A page: { items, nextCursor } (nextCursor is null on the last page). Each item: { id, kind, title, data, updatedAt }, most recently saved first. Only the owner ever sees them.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `PUT /v1/me/drafts`

**Save a draft, or replace the one named by id**

Access: signed in (`Authorization: Bearer <token>`).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | no |  |
| `kind` | one of: `activity`, `trip` | yes |  |
| `data` | object | yes |  |

Responses

- **200**: the saved draft. The form may be half empty: it is only checked when posted.
- **400**: The request is not acceptable. Codes: `DRAFT_TOO_LARGE`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **409**: Conflicts with the current state. Codes: `TOO_MANY_DRAFTS`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `DELETE /v1/me/drafts/{id}`

**Delete a draft**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: { ok: true }
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/me/drafts/{id}/publish`

**Post a draft as a real activity or trip**

Access: signed in (`Authorization: Bearer <token>`).

Needs a **verified adult**.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: the new activity or trip. It is checked like any other; if something is wrong the draft is kept so it can be fixed.
- **400**: The request is not acceptable. Codes: `CONTENT_REJECTED`, `INVALID_DATES`, `INVALID_SCHEDULE`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `VERIFICATION_REQUIRED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `DUPLICATE_ACTIVITY`, `TOO_MANY_OPEN_ACTIVITIES`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/me/no-shows`

**Notes hosts made that I did not come, newest first**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: A page: { items, nextCursor } (nextCursor is null on the last page). Each item: { id, title, state, canDispute, disputeUntil, counts }.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `DELETE /v1/me/photo`

**Remove my profile picture**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `PUT /v1/me/photo`

**Upload my profile picture**

Access: signed in (`Authorization: Bearer <token>`).

The request body is the raw image (Content-Type image/jpeg, image/png or image/webp, 6 MB at most), not JSON.

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `IMAGE_TOO_LARGE`, `INVALID_IMAGE`, `NO_IMAGE`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `PATCH /v1/me/profile`

**Edit my profile (name, city, languages, interests, bio)**

Access: signed in (`Authorization: Bearer <token>`).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `displayName` | string (2 to 40 characters) | no |  |
| `homeCity` | string (0 to 60 characters) or null | no |  |
| `languages` | array of string (2 to 20 characters) | no |  |
| `interests` | array of string (2 to 24 characters) | no |  |
| `bio` | string (0 to 300 characters) or null | no |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `CONTENT_REJECTED`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/me/reliability`

**My reliability level and why**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: { level, label, line }: just the level and one short line. The full breakdown is in the data download (my-data.json), and in the admin console for staff.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/no-shows/{markId}/dispute`

**Dispute the host note within 7 days**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `markId` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `note` | string (3 to 500 characters) | yes |  |

Responses

- **200**: { id, state: "disputed" }. A moderator decides; it counts for nothing meanwhile.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `DISPUTE_CLOSED`, `NOT_DISPUTABLE`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/reliability/info`

**How reliability levels work, in plain words**

Access: public (no token needed).

Responses

- **200**: { items: [{ what, how, why }] }. Public.

### `GET /v1/users/{id}`

**Another person's public profile (never email, documents or location)**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: Name, photo, city, bio, languages, interests, verified-adult badge, counts.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/users/{id}/photo`

**A person's profile picture (WebP)**

Access: public (no token needed).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |
| `s` | query | one of: `96`, `192` | no |  |

Responses

- **200**: Image bytes. Public so image views work without headers. Add s=96 or s=192 for a small copy (lists); without it the full 384-pixel picture comes back. The address carries ?v=<upload time>, so an address never changes and may be kept for a week.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **404**: Not found. Codes: `NOT_FOUND`

## THERE trips

### `GET /v1/me/favorite-trips`

**My favourite trips**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: { items: Trip[], total }. Newest saved first, cancelled trips left out.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `DELETE /v1/me/travel-match`

**Switch travel matching off**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: { ok: true }. Chats that already opened stay until someone ends them.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/me/travel-match`

**Travel matching: my wish and the travelers suggested for it (verified adults only)**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: { pref, suggestions: [{ userId, displayName, photoUrl, homeCity, bio, reliability, destination, dateStart, dateEnd, overlapDays, sharedInterests }] }. Nobody can see who said yes to them.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `PUT /v1/me/travel-match`

**Opt in: where and when I want to travel**

Access: signed in (`Authorization: Bearer <token>`).

Needs a **verified adult**.

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `destination` | string (2 to 100 characters) | yes |  |
| `dateStart` | string (date-time) | yes |  |
| `dateEnd` | string (date-time) | yes |  |

Responses

- **200**: the same as GET. Starts a fresh round: earlier yes or pass answers are cleared.
- **400**: The request is not acceptable. Codes: `CONTENT_REJECTED`, `INVALID_DATES`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `VERIFICATION_REQUIRED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/me/travel-match/chats/{conversationId}/end`

**End a travel-match chat for both people**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `conversationId` | path | string | yes |  |

Responses

- **200**: { ok: true }
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/me/travel-match/people/{userId}`

**Say yes or pass about a suggested traveler**

Access: signed in (`Authorization: Bearer <token>`).

Needs a **verified adult**.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `userId` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `choice` | one of: `yes`, `pass` | yes |  |

Responses

- **200**: { matched, conversationId? }. A yes tells the other person nothing: the answer is the same whether or not they said yes. Two yeses open a private two-person chat.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `VERIFICATION_REQUIRED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `NOT_OPTED_IN`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/me/trips`

**Trips I organize or have joined or applied to**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/me/trips/page`

**My trips, paged**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: A page: { items, nextCursor } (nextCursor is null on the last page).
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/trips`

**Search trips: exact and approximate date matches are labelled, budget scope is shown**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `destination` | query | string | no |  |
| `from` | query | string (date-time) | no |  |
| `to` | query | string (date-time) | no |  |
| `flexibility` | query | one of: `exact`, `plus_minus_1`, `plus_minus_3`, `plus_minus_7`, `same_month` | no | default `"exact"` |
| `originCity` | query | string | no |  |
| `budgetMax` | query | number (0 to 9007199254740991) | no |  |
| `includesTransport` | query | one of: `true`, `false` | no |  |
| `tags` | query | string | no |  |
| `groupSize` | query | one of: `2-3`, `4-6`, `7-10`, `10+` | no |  |
| `openOnly` | query | one of: `true`, `false` | no |  |
| `cursor` | query | string | no |  |
| `limit` | query | number (1 to 50) | no | default `20` |

Responses

- **200**: { total, items, nextCursor }; each item has match.dates = exact | approximate.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/trips`

**Post a trip proposal (not a booking)**

Access: signed in (`Authorization: Bearer <token>`).

Needs a **verified adult**.

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string (2 to 80 characters) | no |  |
| `destination` | string (2 to 100 characters) | yes |  |
| `destinationPlaceId` | string (0 to 200 characters) | no |  |
| `timeZone` | string (0 to 60 characters) | no |  |
| `originCity` | string (2 to 60 characters) | yes |  |
| `dateStart` | string (date-time) | yes |  |
| `dateEnd` | string (date-time) | yes |  |
| `dateFlexibility` | one of: `exact`, `plus_minus_1`, `plus_minus_3`, `plus_minus_7`, `same_month` | no | default `"exact"` |
| `budgetCurrency` | string (3 to 3 characters) | no | default `"EUR"` |
| `budgetMin` | integer (0 to 1000000) | yes |  |
| `budgetMax` | integer (0 to 1000000) | yes |  |
| `budgetIncludesTransport` | boolean | yes |  |
| `tags` | array of string (1 to 24 characters) | no | default `[]` |
| `description` | string (0 to 2000 characters) | no |  |
| `groupSize` | one of: `2-3`, `4-6`, `7-10`, `10+` | no | default `"4-6"` |
| `visibility` | one of: `public`, `invite_only` | no | default `"public"` |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `CONTENT_REJECTED`, `INVALID_DATES`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `VERIFICATION_REQUIRED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/trips/{id}`

**Trip detail; the private plan is visible to approved members only**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `PATCH /v1/trips/{id}`

**Edit a trip (dates or destination notify all members)**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `description` | string (0 to 2000 characters) | no |  |
| `dateStart` | string (date-time) | no |  |
| `dateEnd` | string (date-time) | no |  |
| `dateFlexibility` | one of: `exact`, `plus_minus_1`, `plus_minus_3`, `plus_minus_7`, `same_month` | no |  |
| `destination` | string (2 to 100 characters) | no |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `INVALID_DATES`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_ORGANIZER`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `TRIP_CLOSED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/trips/{id}/appeal`

**Ask the organizer to look again at a declined application (once)**

Access: signed in (`Authorization: Bearer <token>`).

Needs a **verified adult**.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `intro` | string (0 to 500 characters) | no |  |

Responses

- **200**: { id, state }
- **400**: The request is not acceptable. Codes: `CONTENT_REJECTED`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `VERIFICATION_REQUIRED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `ALREADY_APPEALED`, `NOT_DECLINED`, `TRIP_CLOSED`, `TRIP_FULL`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/trips/{id}/applications`

**The organizer's applications, a page at a time: waiting first, then the waiting list, approved, declined, withdrawn, expired**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: A page: { items, nextCursor } (nextCursor is null on the last page). Also { pending }: how many wait for an answer in all, not only on this page.
- **400**: The request is not acceptable. Codes: `INVALID_CURSOR`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_ORGANIZER`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/trips/{id}/applications`

**Apply to join with a short introduction**

Access: signed in (`Authorization: Bearer <token>`).

Needs a **verified adult**.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `intro` | string (10 to 1000 characters) | yes |  |
| `experience` | one of: `beginner`, `intermediate`, `experienced` | no |  |
| `confirmBudget` | `true` | yes |  |
| `confirmDates` | `true` | yes |  |
| `confirmGuidelines` | `true` | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `BLOCKED`, `INVITE_ONLY`, `VERIFICATION_REQUIRED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `ALREADY_APPLIED`, `IS_ORGANIZER`, `TRIP_FULL`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/trips/{id}/applications/{applicationId}/decision`

**Organizer approves or declines an application**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |
| `applicationId` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `decision` | one of: `approve`, `decline` | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_ORGANIZER`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `APPLICANT_UNAVAILABLE`, `APPLICATION_WITHDRAWN`, `TRIP_FULL`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `DELETE /v1/trips/{id}/applications/mine`

**Withdraw my application**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/trips/{id}/cancel`

**Cancel a trip (members are told)**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_ORGANIZER`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/trips/{id}/confirm-dates`

**Confirm the final dates the organizer proposed**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_A_MEMBER`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `NO_DATES_TO_CONFIRM`, `TRIP_CLOSED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `DELETE /v1/trips/{id}/favorite`

**Remove a trip from favourites**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/trips/{id}/favorite`

**Save a trip to favourites**

Access: signed in (`Authorization: Bearer <token>`).

Refused (TRIP_CLOSED) once the trip is cancelled or has started. Removing a favourite is always allowed.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `TRIP_CLOSED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/trips/{id}/host-no-show`

**Member: say the organizer did not show up (same rules as for an activity)**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `note` | string (0 to 1000 characters) | no |  |

Responses

- **200**: { id, status, priority, expectedWithin, coverage, emergency }
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `HOST_ABSENT_TOO_EARLY`, `HOST_ABSENT_WINDOW_CLOSED`, `PLAN_CANCELLED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/trips/{id}/leave`

**Leave a trip group (chat access ends at once)**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `ORGANIZER_CANNOT_LEAVE`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `DELETE /v1/trips/{id}/members/{userId}`

**Organizer removes a member**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |
| `userId` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_ORGANIZER`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `CANNOT_REMOVE_ORGANIZER`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/trips/{id}/no-shows`

**Organizer: who was approved and any note already made**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: { canMark, markableFrom, markableUntil, items }
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/trips/{id}/no-shows`

**Organizer: say a member did not come (from the start until 48 hours after the end)**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `userId` | string (1 or more characters) | yes |  |

Responses

- **200**: { id, state }
- **400**: The request is not acceptable. Codes: `INVALID_TARGET`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `MARK_NOT_OPEN`, `MARK_WINDOW_CLOSED`, `PLAN_CANCELLED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `DELETE /v1/trips/{id}/no-shows/{userId}`

**Organizer: take a note back while it is still just a note**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |
| `userId` | path | string | yes |  |

Responses

- **200**: { ok: true }
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `MARK_LOCKED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/trips/{id}/plan`

**The group shared plan: itinerary by day and estimated costs (members only)**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: { editable, itinerary: { days: [{ day, items }] }, budget: { label, currency, items, perPersonTotal, statedMin, statedMax, comparison, note } }. Lines carry canEdit. Budget notes are estimates, never payments.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_A_MEMBER`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/trips/{id}/plan/items`

**All ideas (kind=ideas) or budget notes (kind=budget) of the plan, a page at a time**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: A page: { items, nextCursor } (nextCursor is null on the last page).
- **400**: The request is not acceptable. Codes: `INVALID_CURSOR`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_A_MEMBER`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/trips/{id}/plan/items`

**Add an itinerary line or a budget note (any member)**

Access: signed in (`Authorization: Bearer <token>`).

Needs a **verified adult**.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | one of: `itinerary`, `budget` | yes |  |
| `title` | string (2 to 100 characters) | yes |  |
| `note` | string (0 to 500 characters) | no |  |
| `day` | string (date-time) | no |  |
| `time` | string | no |  |
| `amount` | integer (0 to 100000) | no |  |

Responses

- **200**: { id }
- **400**: The request is not acceptable. Codes: `CONTENT_REJECTED`, `DAY_OUT_OF_RANGE`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_A_MEMBER`, `VERIFICATION_REQUIRED`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `DAY_PASSED`, `PLAN_FULL`, `TRIP_CLOSED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `DELETE /v1/trips/{id}/plan/items/{itemId}`

**Remove a line (its author or the organizer)**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |
| `itemId` | path | string | yes |  |

Responses

- **200**: { ok: true }
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_A_MEMBER`, `NOT_YOUR_LINE`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `DAY_PASSED`, `TRIP_CLOSED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `PATCH /v1/trips/{id}/plan/items/{itemId}`

**Change a line (its author or the organizer)**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |
| `itemId` | path | string | yes |  |

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | string (2 to 100 characters) | no |  |
| `note` | string (0 to 500 characters) or null | no |  |
| `day` | string (date-time) or null | no |  |
| `time` | string or null | no |  |
| `amount` | integer (0 to 100000) or null | no |  |

Responses

- **200**: { ok: true }
- **400**: The request is not acceptable. Codes: `CONTENT_REJECTED`, `DAY_OUT_OF_RANGE`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `NOT_A_MEMBER`, `NOT_YOUR_LINE`
- **404**: Not found. Codes: `NOT_FOUND`
- **409**: Conflicts with the current state. Codes: `DAY_PASSED`, `TRIP_CLOSED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

## Notifications and push

### `GET /v1/me/notification-settings`

**Which alert groups push to my phone, and my quiet hours**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: { groups: [{ key, label, text, push }], important, quietHours: { enabled, start, end, timezone }, note }. Alerts are always kept in the Alerts list; these settings only decide pushes. Safety and account alerts always get through.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `PUT /v1/me/notification-settings`

**Change which alert groups push, and quiet hours (what is left out stays as it was)**

Access: signed in (`Authorization: Bearer <token>`).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `groups` | object | no |  |
| `quietHours` | object | no |  |
| `quietHours.enabled` | boolean | yes |  |
| `quietHours.start` | string | no |  |
| `quietHours.end` | string | no |  |
| `quietHours.timezone` | string (0 to 64 characters) | no |  |

Responses

- **200**: The settings as they are now (same as GET).
- **400**: The request is not acceptable. Codes: `INVALID_QUIET_HOURS`, `INVALID_TIMEZONE`, `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/notifications`

**My alerts**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: A page: { items, nextCursor } (nextCursor is null on the last page).
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/notifications/{id}/read`

**Mark one alert read**

Access: signed in (`Authorization: Bearer <token>`).

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | string | yes |  |

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **404**: Not found. Codes: `NOT_FOUND`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/notifications/read-all`

**Mark all alerts read (optionally by scope)**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/push/config`

**Public key and settings the app needs to register for push**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/push/subscribe`

**Register this device for push**

Access: signed in (`Authorization: Bearer <token>`).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | one of: `web`, `expo` | yes |  |
| `token` | string (10 to 4000 characters) | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/push/unsubscribe`

**Stop push to this device**

Access: signed in (`Authorization: Bearer <token>`).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `token` | string (10 to 4000 characters) | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `VALIDATION_FAILED`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

## Identity verification

### `DELETE /v1/me/verification`

**Cancel a check that is in progress**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: Done.
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **409**: Conflicts with the current state. Codes: `NOT_PENDING`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `GET /v1/me/verification`

**Where my identity check stands**

Access: signed in (`Authorization: Bearer <token>`).

Responses

- **200**: { state, verifiedUntil, ... }
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`
- **429**: Too many requests. Codes: `RATE_LIMITED`

### `POST /v1/me/verification`

**Start the identity check (needs consent and a confirmed email)**

Access: signed in (`Authorization: Bearer <token>`).

Request body (JSON)

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `consent` | `true` | yes |  |
| `method` | one of: `face`, `document` | no | default `"face"` |

Responses

- **200**: { state, url }: send the person to the provider's hosted page. method "document" is the check with no selfie and no face match.
- **400**: The request is not acceptable. Codes: `CONSENT_REQUIRED`, `VALIDATION_FAILED`, `VERIFICATION_METHOD_UNAVAILABLE`
- **401**: Not signed in. Codes: `INVALID_TOKEN`, `UNAUTHENTICATED`
- **403**: Not allowed. Codes: `ACCOUNT_SUSPENDED`, `ADULT_REQUIRED`, `EMAIL_NOT_VERIFIED`, `VERIFICATION_BLOCKED`
- **429**: Too many requests. Codes: `RATE_LIMITED`
- **502**: Error. Codes: `VERIFICATION_UNAVAILABLE`

### `GET /v1/verification/sandbox/{ref}`

**Development only: the simulated provider page**

Access: public (no token needed).

Refused when NODE_ENV is production, unless DEMO_MODE=true.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `ref` | path | string | yes |  |

Responses

- **200**: Done.
- **404**: Not found. Codes: `NOT_FOUND`

### `POST /v1/verification/sandbox/{ref}/decide`

**Development only: pick the simulated outcome**

Access: public (no token needed).

Refused when NODE_ENV is production, unless DEMO_MODE=true.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `ref` | path | string | yes |  |

Responses

- **200**: Done.
- **404**: Not found. Codes: `NOT_FOUND`

### `POST /v1/verification/webhook/{provider}`

**Provider callback with the result of a check**

Access: public (no token needed).

Called by the identity provider, not the app. The raw body is authenticated by its signature header; only the outcome is kept.

Parameters

| Name | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `provider` | path | string | yes |  |

Responses

- **200**: Done.
- **400**: The request is not acceptable. Codes: `INVALID_PAYLOAD`
- **401**: Not signed in. Codes: `INVALID_SIGNATURE`
- **404**: Not found. Codes: `NOT_FOUND`

## API description

### `GET /v1/openapi.json`

**This document (OpenAPI 3.1), including the error-code list**

Access: public (no token needed).

Responses

- **200**: The OpenAPI document. Public.

## Error codes

Every failure answers `{ statusCode, code, message, details? }`. Branch on `code`, never on `message`.

| Code | Status | What it means | What the app should do |
| --- | --- | --- | --- |
| `ADULT_CONFIRMATION_REQUIRED` | 400 | A new account via Apple or Google needs the 18+ confirmation first. | Show the confirmation, then send the request again with adultConfirmed: true. |
| `BAD_REQUEST` | 400 | The request body could not be read (for example malformed JSON). | Fix the request; do not retry unchanged. |
| `CODE_EXPIRED` | 400 | The confirmation code has expired. | Start the step again. |
| `CONSENT_REQUIRED` | 400 | The person has not agreed to the identity document and facial check. | Show the consent screen before starting. |
| `CONTENT_REJECTED` | 400 | The text broke a content rule (spam links, repetition, or a request for money). `message` says which. | Show the message and let the person edit the text. |
| `DAY_OUT_OF_RANGE` | 400 | The day of a plan line is more than a week outside the dates of the trip. | Let the person pick a day inside the trip. |
| `DRAFT_TOO_LARGE` | 400 | The draft is far longer than any real form. | Ask the person to shorten it. |
| `EMAIL_REQUIRED` | 400 | The provider did not give a confirmed email address, which an account needs. | Offer email sign-up instead. |
| `IMAGE_TOO_LARGE` | 400 | The picture is over the 6 MB limit. | Ask for a smaller picture. |
| `INVALID_CODE` | 400 | The 6-digit code is wrong or has expired. | Offer to send a new code. |
| `INVALID_CURSOR` | 400 | The paging cursor is malformed or was made for a different list. | Restart the list from the first page. |
| `INVALID_DATES` | 400 | The dates are not allowed (for example a trip that starts in the past). | Ask the person to choose other dates. |
| `INVALID_IDEMPOTENCY_KEY` | 400 | The Idempotency-Key header is not 8 to 100 letters, digits, dash, underscore, dot or colon. | Generate a key such as a random id. |
| `INVALID_IMAGE` | 400 | The upload is not a readable JPEG, PNG or WebP picture. | Ask for another picture. |
| `INVALID_LINK` | 400 | A signed download link is malformed or its signature is wrong. | Ask for a new link. |
| `INVALID_PAYLOAD` | 400 | A webhook body is not valid JSON. | Provider-side problem; no user action. |
| `INVALID_PLACE` | 400 | The place cannot be made, or does not exist (a city under a city, a country not under the whole service, an unknown area). | Show the message and let the administrator choose another place. |
| `INVALID_QUIET_HOURS` | 400 | Quiet hours cannot start and end at the same time. | Ask for a different start or end. |
| `INVALID_SCHEDULE` | 400 | The start or end time breaks the rules (not far enough ahead, too long, end before start). | Ask the person to change the time. |
| `INVALID_SETUP_CODE` | 400 | The first code from the authenticator app was wrong while switching two-step sign-in on. | Ask for the next code; check the phone clock. |
| `INVALID_SHIFT` | 400 | The on-call shift is not allowed (ends before it starts, longer than 14 days, or the person is not active staff). | Show the message and let the administrator change it. |
| `INVALID_TARGET` | 400 | The action cannot be aimed at that person (yourself, for example). | Hide the action for that target. |
| `INVALID_TIMEZONE` | 400 | The time zone is not a known name (for example Europe/Rome). | Offer the time zones the phone knows. |
| `LINK_EXPIRED` | 400 | A signed download link is older than its two minutes. | Ask for a new link. |
| `MFA_NOT_STARTED` | 400 | Switching on was attempted before a secret was created. | Start the setup first. |
| `NO_DATES` | 400 | A poll without dates was chosen as the trip dates. | Hide "use these dates" for date-less polls. |
| `NO_IMAGE` | 400 | The picture request had no image bytes in the body. | Fix the client; send the image as the request body. |
| `NOT_A_TRIP_CHAT` | 400 | The action only exists in trip group chats. | Hide the action in activity chats. |
| `REQUEST_FAILED` | 400 | Another 4xx failure that has no specific code. | Show the message. |
| `SAME_EMAIL` | 400 | The new email address is the one already on the account. | Ask for a different address. |
| `SAME_PASSWORD` | 400 | The new password equals the current one. | Ask for a different password. |
| `TOO_MANY_ATTEMPTS` | 400 | Too many wrong codes were entered; the code is locked. | Ask for a new code. |
| `VALIDATION_FAILED` | 400 | One or more fields are missing or invalid. `details` lists each field as { path, message }. | Show each message next to its field. |
| `VERIFICATION_METHOD_UNAVAILABLE` | 400 | The kind of identity check asked for (for example the document-only route) is not set up with the provider. | Offer the other route, or tell the person it is not available right now. |
| `INVALID_CREDENTIALS` | 401 | Email or password is incorrect. | Show the message; never say which one was wrong. |
| `INVALID_MFA_CODE` | 401 | The 6-digit code or recovery code is wrong, or was already used. | Let the person try the next code; after too many tries they are rate-limited. |
| `INVALID_REFRESH_TOKEN` | 401 | The refresh token is not valid, has expired, or belongs to a sign-in that ended (signed out, password changed, suspended). | Send the person to sign in again. |
| `INVALID_SIGNATURE` | 401 | A provider webhook failed its signature check. | Provider-side problem; the request is ignored. |
| `INVALID_SOCIAL_TOKEN` | 401 | The Apple or Google sign-in could not be confirmed (bad signature, wrong app, expired, wrong issuer). | Offer to try again or use email and password. |
| `INVALID_TOKEN` | 401 | The token is invalid, expired, or revoked by a password change. | Sign out and ask the person to sign in again. |
| `MFA_EXPIRED` | 401 | The pass from the password step is missing, expired (5 minutes) or no longer matches the account. | Start the sign-in again. |
| `REFRESH_TOKEN_REUSED` | 401 | An already-used refresh token was shown again after the grace period, so the sign-in was copied and has been ended. | Tell the person they were signed out for safety and send them to sign in. |
| `UNAUTHENTICATED` | 401 | No sign-in token was sent. | Send the person to sign in. |
| `WRONG_PASSWORD` | 401 | The current password given is wrong. | Show the message on the password field. |
| `ACCOUNT_SUSPENDED` | 403 | The account is suspended (the message gives the end date when it is timed). | Show the message and sign the person out. |
| `ADMIN_ONLY` | 403 | Only an administrator can do this. | Hide the action for other staff roles. |
| `ADULT_REQUIRED` | 403 | The person has not confirmed they are 18 or older. | Show the 18+ confirmation. |
| `BLOCKED` | 403 | One of the two people has blocked the other. | Treat as not found; do not reveal who blocked whom. |
| `EMAIL_NOT_VERIFIED` | 403 | The email address must be confirmed first. | Open the email confirmation step. |
| `FORBIDDEN` | 403 | The person is not allowed to do this (staff role too low, or not their own item). | Hide the action; show the message if it was tried. |
| `GLOBAL_STAFF_ONLY` | 403 | A staff account limited to one area used a screen that is only for staff of the whole service. | Hide that screen for staff who have an area (see GET /v1/admin/scope). |
| `GUEST_READ_ONLY` | 403 | A guest ("explore demo") session tried to change something. | Offer to create an account. |
| `INVITE_ONLY` | 403 | The activity or trip is by invitation only. | Hide the join button. |
| `MFA_REQUIRED` | 403 | Staff must have two-step sign-in on to use this part of the console (or to turn it off). | Send the person to the Security page to set it up. |
| `NOT_A_MEMBER` | 403 | The person is not an approved member, so the group chat is closed to them. | Show "pending approval" or the join button, never the chat. |
| `NOT_HOST` | 403 | Only the host of the activity can do this. | Hide the action for other people. |
| `NOT_ORGANIZER` | 403 | Only the organizer of the trip can do this. | Hide the action for other people. |
| `NOT_YOUR_LINE` | 403 | Only the person who added a plan line, or the organizer, can change or remove it. | Hide the edit actions on other people lines. |
| `OUT_OF_SCOPE` | 403 | A staff member who looks after one city, region or country tried to act on something outside it. | Show the message; the item is for staff of another area or the whole service. |
| `OWN_APPEAL` | 403 | Staff cannot decide an appeal they made themselves. | Ask another moderator. |
| `PHONE_BLOCKED` | 403 | This mobile number is on the ban list (it belonged to a removed account). | Show the message and point to support; do not say why. |
| `REGISTRATION_BLOCKED` | 403 | A new account cannot be created for this person right now (it matches a removed account). Staff can review it. | Show the message and point to support; do not say why. |
| `SECOND_REVIEWER` | 403 | The moderator who made a decision cannot review the appeal of it (an administrator can). | Hand the appeal to another moderator. |
| `SOCIAL_NOT_FOR_STAFF` | 403 | Staff accounts cannot sign in with Apple or Google. | Ask them to use their password and code. |
| `STAFF_ACCOUNT` | 403 | Staff accounts are closed by an administrator, not from the app. | Hide self-service deletion for staff. |
| `STAFF_ONLY` | 403 | Two-step sign-in is only available to staff accounts at the moment. | Hide the option for other people. |
| `VERIFICATION_BLOCKED` | 403 | The account could not be verified and self-service retries are closed. | Show the message and point to support. |
| `VERIFICATION_REQUIRED` | 403 | Identity verification is needed (never done, expired, rejected, or re-verification was requested). `details` has the state. | Open the verification screen. |
| `NOT_FOUND` | 404 | The item does not exist, or the person may not know it exists (blocked, invite-only, someone else's). | Show a "not found" state. |
| `ROUTE_NOT_FOUND` | 404 | The URL is not an API route. | Fix the client. |
| `METHOD_NOT_ALLOWED` | 405 | That URL does not accept this HTTP method. | Fix the client. |
| `ACCOUNT_EXISTS` | 409 | An account with this email exists but its email was never confirmed, so it is not linked automatically. | Ask the person to sign in with the password. |
| `ACTIVITY_CANCELLED` | 409 | The activity was cancelled. | Refresh the activity and show it as cancelled. |
| `ACTIVITY_CLOSED` | 409 | The activity can no longer be edited, joined or saved (it was cancelled, started or finished). | Hide the edit, join, favourite and share actions. |
| `ACTIVITY_FINISHED` | 409 | The activity has already finished. | Refresh and show it as completed. |
| `ACTIVITY_FULL` | 409 | No seats left (the person may be put on the waiting list instead). | Show "full" or the waiting-list option. |
| `ALREADY_APPEALED` | 409 | This decision was already appealed once (a suspension: once every 30 days). | Show the earlier appeal and its answer. |
| `ALREADY_APPLIED` | 409 | The person already has an application for this trip; the message names its state. | Show the existing application. |
| `ALREADY_DECIDED` | 409 | This verification check was already decided. | Refresh the case. |
| `ALREADY_REQUESTED` | 409 | The person already has a request for this activity; the message names its state. | Show the existing request. |
| `ALREADY_VERIFIED` | 409 | The person is already verified; use "require re-verification" instead. | Refresh the case. |
| `APPEAL_DECIDED` | 409 | A moderator already decided this appeal. | Reload the queue. |
| `APPEAL_OPEN` | 409 | The person already has an appeal waiting for a decision. | Show it and tell them to wait for the answer. |
| `APPLICANT_UNAVAILABLE` | 409 | The applicant's account can no longer take part (suspended or deleted). | Refresh the list of requests. |
| `APPLICATION_WITHDRAWN` | 409 | The applicant withdrew before the decision. | Refresh the list of applications. |
| `ATTENDANCE_CLOSED` | 409 | Attendance can only be confirmed within 7 days after the end. | Hide the question. |
| `CANNOT_REMOVE_HOST` | 409 | The host cannot be removed from their own activity. | Hide "remove" on the host. |
| `CANNOT_REMOVE_ORGANIZER` | 409 | The organizer cannot be removed from their own trip. | Hide "remove" on the organizer. |
| `CAPACITY_BELOW_MEMBERS` | 409 | The new capacity is lower than the number of approved members. | Show the minimum allowed. |
| `CITY_ALREADY_ASSIGNED` | 409 | That city name already belongs to another place. | Show which place has it; change that one instead. |
| `CONVERSATION_CLOSED` | 409 | The chat is read-only (24 hours after the end, or the activity or trip was cancelled). | Show the chat as read-only. |
| `DAY_PASSED` | 409 | The itinerary line is on a day that has already passed (the trip has started), so it cannot be added, changed, moved or removed. | Only offer days from today on, and hide Edit and Remove on lines whose canEdit is false. |
| `DISPUTE_CLOSED` | 409 | The 7 days to dispute the note have passed. | Hide the Dispute button. |
| `DUPLICATE_ACTIVITY` | 409 | The host already has the same activity at that time or place. | Offer to edit the existing one. |
| `EMAIL_TAKEN` | 409 | An account with this email already exists (changing the email address; sign-up never says this). | Offer sign-in or password reset. |
| `HOST_ABSENT_TOO_EARLY` | 409 | A member tried to say the host did not show up before the plan had been on for 30 minutes. | Offer the action only 30 minutes after the start. |
| `HOST_ABSENT_WINDOW_CLOSED` | 409 | The 72 hours after the plan ended, in which a member can say the host did not show up, have passed. | Hide the action. |
| `HOST_CANNOT_LEAVE` | 409 | The host must cancel or hand over the activity first. | Offer cancel or hand over. |
| `IS_HOST` | 409 | The person is the host of this activity. | Hide the join button. |
| `IS_ORGANIZER` | 409 | The person is the organizer of this trip. | Hide the apply button. |
| `MARK_LOCKED` | 409 | The note was disputed or decided, so the host cannot take it back. | Show the note as it is; a moderator decides. |
| `MARK_NOT_OPEN` | 409 | The host tried to say who did not come before the plan started. | Show the notes only once the plan has started. |
| `MARK_WINDOW_CLOSED` | 409 | The 48 hours after the plan ended, in which a host can say who did not come, have passed. | Hide the action; the host can no longer add notes. |
| `MFA_ALREADY_ON` | 409 | Two-step sign-in is already on for this account. | Show the Security page as it is. |
| `NO_DATES_TO_CONFIRM` | 409 | No final dates are waiting for confirmation. | Refresh the trip. |
| `NOT_DECLINED` | 409 | Only a request or application that the host or organizer declined can be asked about again. | Hide the Ask again action. |
| `NOT_DISPUTABLE` | 409 | The note is already disputed or decided by a moderator. | Show its state. |
| `NOT_FINISHED` | 409 | Attendance can only be given once the activity has ended. | Hide the question until then. |
| `NOT_OPTED_IN` | 409 | The person answered about a traveler without having turned travel matching on. | Show the opt-in screen. |
| `NOT_PENDING` | 409 | There is no identity check in progress. | Refresh the verification status. |
| `NOT_REJECTED` | 409 | Only a rejected verification can be overturned. | Refresh the case. |
| `NOT_VERIFIED` | 409 | Only a verified adult can take over hosting. | Explain that the member must verify first. |
| `NOTHING_TO_APPEAL` | 409 | There is no rejected check, staff removal or suspension to appeal. | Hide the appeal action. |
| `ORGANIZER_CANNOT_LEAVE` | 409 | The organizer must cancel the trip or hand it over first. | Offer cancel. |
| `PHONE_IN_USE` | 409 | This mobile number is already confirmed on another account. | Ask for a different number. |
| `PLACE_HAS_STAFF` | 409 | Staff accounts are still assigned to the place. | Change their area first. |
| `PLACE_NOT_EMPTY` | 409 | The place still has places under it. | Remove or move those first. |
| `PLAN_CANCELLED` | 409 | The plan was cancelled, so nobody can be noted as not coming. | Hide the action. |
| `PLAN_FULL` | 409 | The trip plan already holds the most lines allowed of that kind (60). | Ask the group to tidy the plan first. |
| `POLL_CLOSED` | 409 | The poll is closed; votes are no longer taken. | Show the final result. |
| `REFRESH_IN_PROGRESS` | 409 | Two refreshes of the same sign-in ran at the same moment. | Try again in a moment; keep one refresh at a time in the app. |
| `REQUEST_IN_PROGRESS` | 409 | The first try of this request (same Idempotency-Key) is still being handled. | Wait a moment and send it again with the same key. |
| `REQUEST_WITHDRAWN` | 409 | The applicant withdrew this request before the decision. | Refresh the list of requests. |
| `TOO_MANY_DRAFTS` | 409 | The person already keeps the most drafts allowed (10 per kind). | Offer to delete an old draft first. |
| `TOO_MANY_OPEN_ACTIVITIES` | 409 | The host already has the maximum of upcoming activities (5). | Ask them to finish or cancel one. |
| `TOO_MANY_OPEN_POLLS` | 409 | A trip can have only a few open date polls. | Ask the organizer to close one. |
| `TRIP_CLOSED` | 409 | The trip can no longer be edited, applied to or saved (it was cancelled, has started or is over). | Hide the edit, apply, favourite and share actions. |
| `TRIP_FULL` | 409 | The group is full. | Show "full" or the waiting-list option. |
| `PAYLOAD_TOO_LARGE` | 413 | The request is larger than allowed. | Send less data. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | The content type is not accepted here. | Fix the client. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | This Idempotency-Key was already used for a different request. | Use a new key for every new action; reuse a key only to retry the same one. |
| `RATE_LIMITED` | 429 | Too many requests of this kind in a short time. | Wait and try again; do not retry in a loop. |
| `INTERNAL_ERROR` | 500 | Something failed on the server. Nothing internal is revealed. | Show a "try again" state and retry with a delay. |
| `PLACES_UNAVAILABLE` | 502 | The map service that finds places did not answer. | Let the person type the place name by hand and carry on without a map position. |
| `VERIFICATION_UNAVAILABLE` | 502 | The identity check service (the provider) could not be reached or could not start the check. | Show a "try again in a moment" state. Nothing was started, so starting again is safe. |
| `SOCIAL_UNAVAILABLE` | 503 | The provider could not be reached to check the sign-in. | Try again shortly, or use email and password. |
