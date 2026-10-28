import type { ZodType } from 'zod';
import { z } from 'zod';
import * as account from '../account/account.controller';
import * as activities from '../activities/activities.service';
import * as admin from '../admin/admin.controller';
import * as auth from '../auth/auth.controller';
import * as contact from '../auth/contact-verification.service';
import * as chat from '../conversations/conversations.controller';
import * as push from '../notifications/push.controller';
import * as follows from '../safety/follows.controller';
import * as moderation from '../moderation/moderation.controller';
import * as safety from '../safety/safety.controller';
import * as matching from '../matching/matching.controller';
import * as places from '../places/places.controller';
import * as plan from '../trips/trip-plan.controller';
import * as trips from '../trips/trips.service';

export type RouteDoc = {
  summary: string;
  tag: string;
  /** request body, as the same zod schema the server validates with */
  body?: ZodType;
  /** query string, as the same zod schema the server validates with */
  query?: ZodType;
  /** plain description of the answer */
  returns?: string;
  /** chat, joining, hosting and applying are for verified adults only (spec 3.1) */
  verified?: boolean;
  /** extra error codes this route can raise besides the common ones (every code must exist in the error guide) */
  errors?: string[];
  /** body or query that is not a JSON schema we can show (raw image bytes, signed webhook) */
  note?: string;
};

const T = {
  auth: 'Sign-in and account',
  profile: 'Profile and photo',
  verify: 'Identity verification',
  here: 'HERE activities',
  there: 'THERE trips',
  chat: 'Chat and date polls',
  notify: 'Notifications and push',
  safety: 'Safety, blocks and follows',
  admin: 'Admin console',
  docs: 'API description',
  share: 'Shared links',
} as const;

const page = 'A page: { items, nextCursor } (nextCursor is null on the last page).';
const accept = z.object({ accept: z.boolean() });
const attended = z.object({ attended: z.boolean() });
const userRef = z.object({ userId: z.string().min(1) });
const adopt = z.object({ adopt: z.boolean().default(false) });

/** One entry per route. A test fails when a route exists without an entry (or an entry without a route). */
export const ROUTE_DOCS: Record<string, RouteDoc> = {
  'GET /a/{id}': { tag: T.share, summary: 'A shared activity link: sends people to the app, or to the App Store / Google Play', returns: 'A web page (HTML), not JSON. It shows only the title, the day and the city, and only for a public plan that is still on; anything else gets the same page with a 404 status. On an iPhone or an Android phone it moves on to the store by itself.', note: 'Public. Where the app is installed the phone opens the app on this link and never loads the page (iOS Universal Links, Android App Links).', errors: ['RATE_LIMITED'] },
  'GET /t/{id}': { tag: T.share, summary: 'A shared trip link: sends people to the app, or to the App Store / Google Play', returns: 'A web page (HTML), not JSON. It shows only the title, the destination and the dates, and only for a trip that is still open; anything else gets the same page with a 404 status.', note: 'Public. Works like /a/{id}.', errors: ['RATE_LIMITED'] },
  'GET /.well-known/apple-app-site-association': { tag: T.share, summary: 'Tells iPhones which links open the app (Universal Links)', returns: 'JSON, or 404 until APPLE_TEAM_ID is set', note: 'Public. Apple reads it when the app is installed or updated.' },
  'GET /.well-known/assetlinks.json': { tag: T.share, summary: 'Tells Android which links open the app (App Links)', returns: 'JSON, or 404 until ANDROID_CERT_SHA256 is set', note: 'Public. Google checks it when the app is installed.' },
  // ---------------------------------------------------------------- sign-in and account
  'POST /v1/auth/register': { tag: T.auth, summary: 'Create an account (18+ confirmation required)', body: auth.registerSchema, returns: '{ token, user }. A 6-digit email code is sent (in development the code is echoed back as devCode).', errors: ['EMAIL_TAKEN', 'REGISTRATION_BLOCKED', 'RATE_LIMITED'] },
  'POST /v1/auth/login': { tag: T.auth, summary: 'Sign in with email and password', body: auth.loginSchema, returns: '{ token, user }', errors: ['INVALID_CREDENTIALS', 'ACCOUNT_SUSPENDED', 'RATE_LIMITED'] },
  'POST /v1/auth/guest': { tag: T.auth, summary: 'Start a read-only "explore" session without an account (24 hours)', returns: '{ token, user }; every non-GET call afterwards fails with GUEST_READ_ONLY.', errors: ['RATE_LIMITED'] },
  'POST /v1/auth/password/forgot': { tag: T.auth, summary: 'Email a password-reset code', body: auth.forgotSchema, returns: '{ ok: true } whether or not the address exists (no account probing).', errors: ['RATE_LIMITED'] },
  'POST /v1/auth/password/reset': { tag: T.auth, summary: 'Set a new password with the emailed code', body: auth.resetSchema, returns: '{ ok: true }. Every earlier sign-in stops working.', errors: ['INVALID_CODE', 'TOO_MANY_ATTEMPTS', 'RATE_LIMITED'] },
  'POST /v1/me/password': { tag: T.auth, summary: 'Change the password while signed in', body: auth.changeSchema, returns: '{ ok: true, token }: other devices are signed out, this one gets a fresh token.', errors: ['WRONG_PASSWORD', 'SAME_PASSWORD'] },
  'GET /v1/me': { tag: T.auth, summary: 'The signed-in person: profile, role and the three separate statuses (email, adult, identity)', returns: 'The person. ETag supported (If-None-Match gives 304).' },
  'POST /v1/me/email/send-code': { tag: T.auth, summary: 'Send the 6-digit email confirmation code', returns: '{ ok: true }', errors: ['RATE_LIMITED'] },
  'POST /v1/me/email/verify': { tag: T.auth, summary: 'Confirm the email address with the code', body: contact.codeSchema, returns: '{ ok: true }', errors: ['INVALID_CODE', 'CODE_EXPIRED', 'TOO_MANY_ATTEMPTS'] },
  'POST /v1/me/email/change': { tag: T.auth, summary: 'Start changing the email address (code is sent to the new address)', body: account.changeEmailSchema, errors: ['WRONG_PASSWORD', 'SAME_EMAIL', 'EMAIL_TAKEN', 'RATE_LIMITED'] },
  'POST /v1/me/email/change/confirm': { tag: T.auth, summary: 'Finish changing the email address with the code', body: account.confirmSchema, errors: ['INVALID_CODE', 'CODE_EXPIRED', 'TOO_MANY_ATTEMPTS'] },
  'POST /v1/me/phone/send-code': { tag: T.auth, summary: 'Send an SMS code to an optional mobile number', body: contact.phoneSchema, errors: ['PHONE_IN_USE', 'PHONE_BLOCKED', 'RATE_LIMITED'] },
  'POST /v1/me/phone/verify': { tag: T.auth, summary: 'Confirm the mobile number with the SMS code', body: contact.codeSchema, errors: ['PHONE_IN_USE', 'INVALID_CODE', 'CODE_EXPIRED', 'TOO_MANY_ATTEMPTS'] },
  'DELETE /v1/me/phone': { tag: T.auth, summary: 'Remove the mobile number' },
  'POST /v1/me/export/zip-link': { tag: T.auth, summary: 'A two-minute link to download a copy of my data (ZIP)', returns: '{ url, expiresInSeconds }. Open the url to download a ZIP with my-data.json (profile, plans, messages, follows, alerts, identity-check outcomes, account activity) and a README. Limited to 1 a day. Body: { lang?: "en" | "it" }.', note: 'Data access right, spec 9.2.' },
  'GET /v1/export/zip': { tag: T.auth, summary: 'The ZIP copy of my data (signed link, no login header)', returns: 'The ZIP file (application/zip).', note: 'Public: the signed link in the t parameter is the login. It names the person, the language and an expiry.', errors: ['INVALID_LINK', 'LINK_EXPIRED'] },
  'POST /v1/me/delete': { tag: T.auth, summary: 'Delete my account and erase my personal data (spec 9.2)', body: account.deleteSchema, returns: '{ ok: true }. Open plans are cancelled or left first; messages that a report points at are kept for safety review.', errors: ['WRONG_PASSWORD', 'STAFF_ACCOUNT', 'ACCOUNT_SUSPENDED'] },
  // ---------------------------------------------------------------- profile
  'PATCH /v1/me/profile': { tag: T.profile, summary: 'Edit my profile (name, city, languages, interests, bio)', body: auth.profileSchema, errors: ['CONTENT_REJECTED'] },
  'GET /v1/users/{id}': { tag: T.profile, summary: 'Another person\'s public profile (never email, documents or location)', returns: 'Name, photo, city, bio, languages, interests, verified-adult badge, counts.', errors: ['NOT_FOUND'] },
  'PUT /v1/me/photo': { tag: T.profile, summary: 'Upload my profile picture', note: 'The request body is the raw image (Content-Type image/jpeg, image/png or image/webp, 6 MB at most), not JSON.', errors: ['NO_IMAGE', 'INVALID_IMAGE', 'IMAGE_TOO_LARGE'] },
  'DELETE /v1/me/photo': { tag: T.profile, summary: 'Remove my profile picture' },
  'GET /v1/users/{id}/photo': { tag: T.profile, summary: 'A person\'s profile picture (WebP)', returns: 'Image bytes. Public so image views work without headers.', errors: ['NOT_FOUND'] },
  // ---------------------------------------------------------------- identity verification
  'GET /v1/me/verification': { tag: T.verify, summary: 'Where my identity check stands', returns: '{ state, verifiedUntil, ... }' },
  'POST /v1/auth/social': { tag: T.auth, summary: 'Sign in or sign up with Apple or Google', body: auth.socialSchema, returns: '{ token, user } (or { mfaRequired, mfaToken } is never returned: staff cannot use this). The ID token is checked against the provider\'s keys. A new account needs adultConfirmed: true.', errors: ['INVALID_SOCIAL_TOKEN', 'SOCIAL_UNAVAILABLE', 'SOCIAL_NOT_FOR_STAFF', 'ACCOUNT_EXISTS', 'ADULT_CONFIRMATION_REQUIRED', 'EMAIL_REQUIRED', 'REGISTRATION_BLOCKED', 'ACCOUNT_SUSPENDED'] },
  'GET /v1/auth/social/providers': { tag: T.auth, summary: 'Which social sign-in providers are switched on', returns: '{ apple: boolean, google: boolean }' },
  'POST /v1/auth/mfa/verify': { tag: T.auth, summary: 'Finish a two-step sign-in with the code', body: z.object({ mfaToken: z.string().min(10), code: z.string().min(6).max(20) }), returns: '{ token, usedRecoveryCode, user }. mfaToken is the short-lived pass returned by the password step.', errors: ['INVALID_MFA_CODE', 'MFA_EXPIRED', 'RATE_LIMITED'] },
  'GET /v1/me/mfa': { tag: T.auth, summary: 'Where my two-step sign-in stands', returns: '{ enabled, required, recoveryCodesLeft }' },
  'POST /v1/me/mfa/setup': { tag: T.auth, summary: 'Start two-step sign-in (staff): get the secret for an authenticator app', returns: '{ secret, otpauthUri }. Nothing is on until a code is confirmed.', errors: ['STAFF_ONLY', 'MFA_ALREADY_ON'] },
  'POST /v1/me/mfa/enable': { tag: T.auth, summary: 'Switch two-step sign-in on with the first code from the app', body: z.object({ code: z.string().min(6).max(20) }), returns: '{ enabled: true, recoveryCodes }: eight one-time codes, shown only now.', errors: ['INVALID_SETUP_CODE', 'MFA_NOT_STARTED', 'MFA_ALREADY_ON', 'STAFF_ONLY'] },
  'DELETE /v1/me/mfa': { tag: T.auth, summary: 'Switch two-step sign-in off (not allowed for staff where it is required)', body: z.object({ password: z.string().min(1), code: z.string().min(6).max(20) }), returns: '{ enabled: false }', errors: ['MFA_REQUIRED', 'WRONG_PASSWORD', 'INVALID_MFA_CODE', 'STAFF_ONLY'] },
  'GET /v1/reliability/info': { tag: T.profile, summary: 'How reliability levels work, in plain words', returns: '{ items: [{ what, how, why }] }. Public.' },
  'GET /v1/me/reliability': { tag: T.profile, summary: 'My reliability level and why', returns: '{ level, label, line }: just the level and one short line. The full breakdown is in the data download (my-data.json), and in the admin console for staff.' },
  'GET /v1/me/no-shows': { tag: T.profile, summary: 'Notes hosts made that I did not come, newest first', returns: page + ' Each item: { id, title, state, canDispute, disputeUntil, counts }.' },
  'POST /v1/no-shows/{markId}/dispute': { tag: T.profile, summary: 'Dispute the host note within 7 days', body: z.object({ note: z.string().min(3).max(500) }), returns: '{ id, state: "disputed" }. A moderator decides; it counts for nothing meanwhile.', errors: ['NOT_DISPUTABLE', 'DISPUTE_CLOSED'] },
  'GET /v1/activities/{id}/no-shows': { tag: T.here, summary: 'Host: who was approved and any note already made', returns: '{ canMark, markableFrom, markableUntil, items }' },
  'POST /v1/activities/{id}/no-shows': { tag: T.here, summary: 'Host: say a member did not come (from the start until 48 hours after the end)', body: z.object({ userId: z.string().min(1) }), returns: '{ id, state }. The member is told and can dispute for 7 days; it only counts once confirmed.', errors: ['MARK_NOT_OPEN', 'MARK_WINDOW_CLOSED', 'PLAN_CANCELLED', 'INVALID_TARGET'] },
  'DELETE /v1/activities/{id}/no-shows/{userId}': { tag: T.here, summary: 'Host: take a note back while it is still just a note', returns: '{ ok: true }', errors: ['MARK_LOCKED'] },
  'GET /v1/trips/{id}/no-shows': { tag: T.there, summary: 'Organizer: who was approved and any note already made', returns: '{ canMark, markableFrom, markableUntil, items }' },
  'POST /v1/trips/{id}/no-shows': { tag: T.there, summary: 'Organizer: say a member did not come (from the start until 48 hours after the end)', body: z.object({ userId: z.string().min(1) }), returns: '{ id, state }', errors: ['MARK_NOT_OPEN', 'MARK_WINDOW_CLOSED', 'PLAN_CANCELLED', 'INVALID_TARGET'] },
  'DELETE /v1/trips/{id}/no-shows/{userId}': { tag: T.there, summary: 'Organizer: take a note back while it is still just a note', returns: '{ ok: true }', errors: ['MARK_LOCKED'] },
  'GET /v1/admin/no-shows': { tag: T.admin, summary: 'No-show notes waiting for a moderator (disputed and pending)', query: z.object({ state: z.string().optional() }), returns: '{ items }' },
  'POST /v1/admin/no-shows/{markId}/decision': { tag: T.admin, summary: 'Uphold or overturn a no-show note (any note, to fix mistakes)', body: z.object({ decision: z.enum(['uphold', 'overturn']), note: z.string().min(3).max(500) }), returns: '{ id, state }. Both people are told.' },
  'GET /v1/trips/{id}/plan': { tag: T.there, summary: 'The group shared plan: itinerary by day and estimated costs (members only)', returns: '{ editable, itinerary: { days: [{ day, items }] }, budget: { label, currency, items, perPersonTotal, statedMin, statedMax, comparison, note } }. Lines carry canEdit. Budget notes are estimates, never payments.', errors: ['NOT_A_MEMBER'] },
  'GET /v1/trips/{id}/plan/items': { tag: T.there, summary: 'All ideas (kind=ideas) or budget notes (kind=budget) of the plan, a page at a time', returns: page, errors: ['NOT_A_MEMBER', 'INVALID_CURSOR', 'VALIDATION_FAILED'] },
  'POST /v1/trips/{id}/plan/items': { tag: T.there, summary: 'Add an itinerary line or a budget note (any member)', body: plan.itemSchema, verified: true, returns: '{ id }', errors: ['NOT_A_MEMBER', 'TRIP_CLOSED', 'DAY_PASSED', 'CONTENT_REJECTED', 'DAY_OUT_OF_RANGE', 'PLAN_FULL', 'RATE_LIMITED'] },
  'PATCH /v1/trips/{id}/plan/items/{itemId}': { tag: T.there, summary: 'Change a line (its author or the organizer)', body: plan.itemUpdateSchema, returns: '{ ok: true }', errors: ['NOT_A_MEMBER', 'TRIP_CLOSED', 'DAY_PASSED', 'NOT_YOUR_LINE', 'CONTENT_REJECTED', 'DAY_OUT_OF_RANGE'] },
  'DELETE /v1/trips/{id}/plan/items/{itemId}': { tag: T.there, summary: 'Remove a line (its author or the organizer)', returns: '{ ok: true }', errors: ['NOT_A_MEMBER', 'TRIP_CLOSED', 'DAY_PASSED', 'NOT_YOUR_LINE'] },
  'GET /v1/me/travel-match': { tag: T.there, summary: 'Travel matching: my wish and the travelers suggested for it (verified adults only)', returns: '{ pref, suggestions: [{ userId, displayName, photoUrl, homeCity, bio, reliability, destination, dateStart, dateEnd, overlapDays, sharedInterests }] }. Nobody can see who said yes to them.' },
  'PUT /v1/me/travel-match': { tag: T.there, summary: 'Opt in: where and when I want to travel', body: matching.prefSchema, verified: true, returns: 'the same as GET. Starts a fresh round: earlier yes or pass answers are cleared.', errors: ['INVALID_DATES', 'CONTENT_REJECTED', 'RATE_LIMITED'] },
  'DELETE /v1/me/travel-match': { tag: T.there, summary: 'Switch travel matching off', returns: '{ ok: true }. Chats that already opened stay until someone ends them.' },
  'POST /v1/me/travel-match/people/{userId}': { tag: T.there, summary: 'Say yes or pass about a suggested traveler', body: matching.choiceSchema, verified: true, returns: '{ matched, conversationId? }. A yes tells the other person nothing: the answer is the same whether or not they said yes. Two yeses open a private two-person chat.', errors: ['NOT_OPTED_IN', 'RATE_LIMITED'] },
  'POST /v1/me/travel-match/chats/{conversationId}/end': { tag: T.there, summary: 'End a travel-match chat for both people', returns: '{ ok: true }' },
  'GET /v1/me/drafts': { tag: T.profile, summary: 'My saved drafts (activities and trips not yet posted)', returns: page + ' Each item: { id, kind, title, data, updatedAt }, most recently saved first. Only the owner ever sees them.' },
  'PUT /v1/me/drafts': { tag: T.profile, summary: 'Save a draft, or replace the one named by id', body: z.object({ id: z.string().optional(), kind: z.enum(['activity', 'trip']), data: z.record(z.string(), z.unknown()) }), returns: 'the saved draft. The form may be half empty: it is only checked when posted.', errors: ['DRAFT_TOO_LARGE', 'TOO_MANY_DRAFTS'] },
  'DELETE /v1/me/drafts/{id}': { tag: T.profile, summary: 'Delete a draft', returns: '{ ok: true }' },
  'POST /v1/me/drafts/{id}/publish': { tag: T.profile, summary: 'Post a draft as a real activity or trip', returns: 'the new activity or trip. It is checked like any other; if something is wrong the draft is kept so it can be fixed.', verified: true, errors: ['INVALID_SCHEDULE', 'DUPLICATE_ACTIVITY', 'TOO_MANY_OPEN_ACTIVITIES', 'CONTENT_REJECTED', 'INVALID_DATES'] },
  'POST /v1/me/appeals': { tag: T.profile, summary: 'Ask staff to look again: a rejected identity check, a listing or message staff removed, a warning, or a report of yours that was dismissed', body: z.object({ kind: z.enum(['verification', 'removal', 'report', 'warning', 'message']), targetType: z.enum(['activity', 'trip']).optional(), targetId: z.string().optional(), message: z.string().min(10).max(1000) }), returns: '{ id, kind, state: "open" }. Once per decision.', errors: ['NOTHING_TO_APPEAL', 'ALREADY_APPEALED', 'APPEAL_OPEN', 'CONTENT_REJECTED', 'RATE_LIMITED'] },
  'GET /v1/me/appeals': { tag: T.profile, summary: 'My appeals and what was decided, newest first', returns: page + ' Each item: { id, kind, what, state, decision, createdAt, decidedAt }.' },
  'POST /v1/appeals/suspension': { tag: T.auth, summary: 'Appeal a suspension (the person cannot sign in, so email and password are sent)', body: z.object({ email: z.string().email(), password: z.string(), message: z.string().min(10).max(1000) }), returns: '{ id, state: "open" }. The answer comes by email. Once every 30 days.', errors: ['INVALID_CREDENTIALS', 'NOTHING_TO_APPEAL', 'ALREADY_APPEALED', 'APPEAL_OPEN', 'CONTENT_REJECTED', 'RATE_LIMITED'] },
  'GET /v1/admin/appeals': { tag: T.admin, summary: 'Appeals waiting for a decision (or decided: state=upheld|rejected)', query: z.object({ state: z.string().optional() }), returns: '{ items }' },
  'POST /v1/admin/appeals/{id}/decision': { tag: T.admin, summary: 'Accept (uphold) or reject an appeal, with a note the person sees', body: z.object({ decision: z.enum(['uphold', 'reject']), note: z.string().min(3).max(500) }), returns: '{ id, state }. Upholding undoes the decision: verified again, account restored, or listing put back.', errors: ['APPEAL_DECIDED', 'OWN_APPEAL', 'NOT_REJECTED', 'ADMIN_ONLY'] },
  'POST /v1/activities/{id}/appeal': { tag: T.here, summary: 'Ask the host to look again at a declined request (once)', body: activities.requestSchema, verified: true, returns: '{ id, state }: back to the host as a new request, or the waiting list if it filled up.', errors: ['NOT_DECLINED', 'ALREADY_APPEALED', 'ACTIVITY_CLOSED', 'CONTENT_REJECTED'] },
  'POST /v1/trips/{id}/appeal': { tag: T.there, summary: 'Ask the organizer to look again at a declined application (once)', body: z.object({ intro: z.string().max(500).optional() }), verified: true, returns: '{ id, state }', errors: ['NOT_DECLINED', 'ALREADY_APPEALED', 'TRIP_CLOSED', 'TRIP_FULL', 'CONTENT_REJECTED'] },
  'GET /v1/admin/users/{id}/reliability': { tag: T.admin, summary: 'Everything behind a person level: events, weights, notes and level history', returns: '{ level, summary, penalties, events, marks, changes }' },
  'POST /v1/me/verification': { tag: T.verify, summary: 'Start the identity check (needs consent and a confirmed email)', body: z.object({ consent: z.literal(true), method: z.enum(['face', 'document']).default('face') }), returns: '{ state, url }: send the person to the provider\'s hosted page. method "document" is the check with no selfie and no face match.', errors: ['CONSENT_REQUIRED', 'EMAIL_NOT_VERIFIED', 'ADULT_REQUIRED', 'VERIFICATION_BLOCKED', 'RATE_LIMITED', 'VERIFICATION_UNAVAILABLE', 'VERIFICATION_METHOD_UNAVAILABLE'] },
  'DELETE /v1/me/verification': { tag: T.verify, summary: 'Cancel a check that is in progress', errors: ['NOT_PENDING'] },
  'POST /v1/verification/webhook/{provider}': { tag: T.verify, summary: 'Provider callback with the result of a check', note: 'Called by the identity provider, not the app. The raw body is authenticated by its signature header; only the outcome is kept.', errors: ['INVALID_SIGNATURE', 'INVALID_PAYLOAD'] },
  'GET /v1/verification/sandbox/{ref}': { tag: T.verify, summary: 'Development only: the simulated provider page', note: 'Refused when NODE_ENV is production, unless DEMO_MODE=true.' },
  'POST /v1/verification/sandbox/{ref}/decide': { tag: T.verify, summary: 'Development only: pick the simulated outcome', note: 'Refused when NODE_ENV is production, unless DEMO_MODE=true.' },
  // ---------------------------------------------------------------- HERE
  'GET /v1/places/search': { tag: T.here, summary: 'Search for a real place by name or address (for the meeting location)', query: places.searchSchema, returns: '{ items: [{ id, name, address, lat, lng }] }, up to 6, best match first. Answers are cached for 10 minutes.', errors: ['PLACES_UNAVAILABLE', 'RATE_LIMITED'] },
  'GET /v1/activities': { tag: T.here, summary: 'Discover activities (filters, distance, ranking)', query: activities.listSchema, returns: page },
  'POST /v1/activities': { tag: T.here, summary: 'Create an activity', body: activities.createSchema, verified: true, errors: ['INVALID_SCHEDULE', 'DUPLICATE_ACTIVITY', 'TOO_MANY_OPEN_ACTIVITIES', 'CONTENT_REJECTED', 'RATE_LIMITED'] },
  'GET /v1/activities/{id}': { tag: T.here, summary: 'Activity detail, with my own status (member, requested, waitlisted...)', errors: ['NOT_FOUND'] },
  'PATCH /v1/activities/{id}': { tag: T.here, summary: 'Edit an activity (material changes notify members and ask them to reconfirm)', body: activities.updateSchema, errors: ['NOT_HOST', 'ACTIVITY_CLOSED', 'CAPACITY_BELOW_MEMBERS', 'INVALID_SCHEDULE', 'CONTENT_REJECTED'] },
  'POST /v1/activities/{id}/cancel': { tag: T.here, summary: 'Cancel an activity (members are told)', errors: ['NOT_HOST', 'ACTIVITY_FINISHED'] },
  'POST /v1/activities/{id}/reconfirm': { tag: T.here, summary: 'Confirm I still come after a material change' },
  'POST /v1/activities/{id}/handover': { tag: T.here, summary: 'Offer hosting to a member (they must accept)', body: userRef, errors: ['NOT_HOST', 'NOT_VERIFIED'] },
  'DELETE /v1/activities/{id}/handover': { tag: T.here, summary: 'Withdraw a hosting offer', errors: ['NOT_HOST'] },
  'POST /v1/activities/{id}/handover/answer': { tag: T.here, summary: 'Accept or decline an offer to take over hosting', body: accept, verified: true },
  'POST /v1/activities/{id}/attendance': { tag: T.here, summary: 'Say whether I attended (voluntary, about myself)', body: attended, errors: ['NOT_FINISHED', 'ATTENDANCE_CLOSED'] },
  'POST /v1/activities/{id}/requests': { tag: T.here, summary: 'Ask to join (goes on the waiting list when full)', body: activities.requestSchema, verified: true, errors: ['ALREADY_REQUESTED', 'IS_HOST', 'BLOCKED', 'INVITE_ONLY', 'ACTIVITY_CANCELLED', 'ACTIVITY_FINISHED', 'RATE_LIMITED'] },
  'GET /v1/activities/{id}/requests': { tag: T.here, summary: 'The host\'s join requests, a page at a time: waiting for an answer first, then the waiting list, approved, declined, withdrawn', returns: page + ' Also { pending }: how many wait for an answer in all, not only on this page.', errors: ['NOT_HOST', 'INVALID_CURSOR'] },
  'POST /v1/activities/{id}/requests/{requestId}/decision': { tag: T.here, summary: 'Host approves or declines a request', body: activities.decisionSchema, errors: ['NOT_HOST', 'ACTIVITY_FULL', 'APPLICANT_UNAVAILABLE', 'REQUEST_WITHDRAWN'] },
  'DELETE /v1/activities/{id}/requests/mine': { tag: T.here, summary: 'Withdraw my request' },
  'POST /v1/activities/{id}/leave': { tag: T.here, summary: 'Leave an activity (chat access ends at once)', errors: ['HOST_CANNOT_LEAVE'] },
  'DELETE /v1/activities/{id}/members/{userId}': { tag: T.here, summary: 'Host removes a member (chat access ends at once)', errors: ['NOT_HOST', 'CANNOT_REMOVE_HOST'] },
  'POST /v1/activities/{id}/favorite': { tag: T.here, summary: 'Save an activity to favourites', note: 'Refused (ACTIVITY_CLOSED) once the activity is cancelled or has started. Removing a favourite is always allowed.', errors: ['ACTIVITY_CLOSED'] },
  'DELETE /v1/activities/{id}/favorite': { tag: T.here, summary: 'Remove an activity from favourites' },
  'GET /v1/me/favorites': { tag: T.here, summary: 'My favourite activities', returns: page },
  'POST /v1/trips/{id}/favorite': { tag: T.there, summary: 'Save a trip to favourites', note: 'Refused (TRIP_CLOSED) once the trip is cancelled or has started. Removing a favourite is always allowed.', errors: ['TRIP_CLOSED'] },
  'DELETE /v1/trips/{id}/favorite': { tag: T.there, summary: 'Remove a trip from favourites' },
  'GET /v1/me/favorite-trips': { tag: T.there, summary: 'My favourite trips', returns: '{ items: Trip[], total }. Newest saved first, cancelled trips left out.' },
  'GET /v1/me/activities': { tag: T.here, summary: 'Everything I host, go to, or have requested' },
  'GET /v1/me/activities/soon': { tag: T.here, summary: 'My plans on now or starting within a few hours (Home "Next up")' },
  'GET /v1/me/activities/overlapping': { tag: T.here, summary: 'My plans that overlap a time window' },
  'GET /v1/me/activities/page': { tag: T.here, summary: 'My activities by tab, paged', returns: page },
  // ---------------------------------------------------------------- THERE
  'GET /v1/trips': { tag: T.there, summary: 'Search trips: exact and approximate date matches are labelled, budget scope is shown', query: trips.searchSchema, returns: '{ total, items, nextCursor }; each item has match.dates = exact | approximate.' },
  'POST /v1/trips': { tag: T.there, summary: 'Post a trip proposal (not a booking)', body: trips.createSchema, verified: true, errors: ['INVALID_DATES', 'CONTENT_REJECTED', 'RATE_LIMITED'] },
  'GET /v1/trips/{id}': { tag: T.there, summary: 'Trip detail; the private plan is visible to approved members only', errors: ['NOT_FOUND'] },
  'PATCH /v1/trips/{id}': { tag: T.there, summary: 'Edit a trip (dates or destination notify all members)', body: trips.updateSchema, errors: ['NOT_ORGANIZER', 'TRIP_CLOSED', 'INVALID_DATES'] },
  'POST /v1/trips/{id}/cancel': { tag: T.there, summary: 'Cancel a trip (members are told)', errors: ['NOT_ORGANIZER'] },
  'POST /v1/trips/{id}/applications': { tag: T.there, summary: 'Apply to join with a short introduction', body: trips.applySchema, verified: true, errors: ['ALREADY_APPLIED', 'IS_ORGANIZER', 'BLOCKED', 'INVITE_ONLY', 'TRIP_FULL', 'RATE_LIMITED'] },
  'GET /v1/trips/{id}/applications': { tag: T.there, summary: 'The organizer\'s applications, a page at a time: waiting first, then the waiting list, approved, declined, withdrawn, expired', returns: page + ' Also { pending }: how many wait for an answer in all, not only on this page.', errors: ['NOT_ORGANIZER', 'INVALID_CURSOR'] },
  'POST /v1/trips/{id}/applications/{applicationId}/decision': { tag: T.there, summary: 'Organizer approves or declines an application', body: trips.decisionSchema, errors: ['NOT_ORGANIZER', 'TRIP_FULL', 'APPLICATION_WITHDRAWN', 'APPLICANT_UNAVAILABLE'] },
  'DELETE /v1/trips/{id}/applications/mine': { tag: T.there, summary: 'Withdraw my application' },
  'POST /v1/trips/{id}/leave': { tag: T.there, summary: 'Leave a trip group (chat access ends at once)', errors: ['ORGANIZER_CANNOT_LEAVE'] },
  'DELETE /v1/trips/{id}/members/{userId}': { tag: T.there, summary: 'Organizer removes a member', errors: ['NOT_ORGANIZER', 'CANNOT_REMOVE_ORGANIZER'] },
  'POST /v1/trips/{id}/confirm-dates': { tag: T.there, summary: 'Confirm the final dates the organizer proposed', errors: ['NO_DATES_TO_CONFIRM', 'NOT_A_MEMBER', 'TRIP_CLOSED'] },
  'GET /v1/me/trips': { tag: T.there, summary: 'Trips I organize or have joined or applied to' },
  'GET /v1/me/trips/page': { tag: T.there, summary: 'My trips, paged', returns: page },
  // ---------------------------------------------------------------- chat
  'GET /v1/me/conversations': { tag: T.chat, summary: 'My chats, newest message first', returns: page },
  'GET /v1/conversations/{id}/info': { tag: T.chat, summary: 'Who is in a chat and whether it is still writable', verified: true, errors: ['NOT_A_MEMBER'] },
  'GET /v1/conversations/{id}/messages': { tag: T.chat, summary: 'Messages of a chat (membership is checked live on every call)', query: z.object({ read: z.enum(['0', '1']).optional(), limit: z.coerce.number().int().min(1).max(100).optional(), cursor: z.string().optional() }), returns: page, verified: true, errors: ['NOT_A_MEMBER', 'INVALID_CURSOR'] },
  'POST /v1/conversations/{id}/messages': { tag: T.chat, summary: 'Send a message', body: chat.sendSchema, verified: true, errors: ['NOT_A_MEMBER', 'CONVERSATION_CLOSED', 'CONTENT_REJECTED', 'RATE_LIMITED'] },
  'POST /v1/conversations/{id}/polls': { tag: T.chat, summary: 'Organizer starts a date poll in a trip chat', body: chat.pollSchema, verified: true, errors: ['NOT_ORGANIZER', 'NOT_A_TRIP_CHAT', 'TOO_MANY_OPEN_POLLS', 'CONTENT_REJECTED', 'RATE_LIMITED', 'TRIP_CLOSED'] },
  'POST /v1/polls/{pollId}/vote': { tag: T.chat, summary: 'Accept or reject the dates in a poll', body: chat.voteSchema, verified: true, errors: ['POLL_CLOSED', 'NOT_A_MEMBER'] },
  'POST /v1/polls/{pollId}/close': { tag: T.chat, summary: 'Organizer closes a poll, optionally making its dates the proposed final dates', body: adopt, verified: true, errors: ['NOT_ORGANIZER', 'POLL_CLOSED', 'NO_DATES'] },
  // ---------------------------------------------------------------- notifications
  'GET /v1/notifications': { tag: T.notify, summary: 'My alerts', returns: page },
  'POST /v1/notifications/{id}/read': { tag: T.notify, summary: 'Mark one alert read' },
  'POST /v1/notifications/read-all': { tag: T.notify, summary: 'Mark all alerts read (optionally by scope)' },
  'GET /v1/push/config': { tag: T.notify, summary: 'Public key and settings the app needs to register for push' },
  'POST /v1/push/subscribe': { tag: T.notify, summary: 'Register this device for push', body: push.subscribeSchema },
  'POST /v1/push/unsubscribe': { tag: T.notify, summary: 'Stop push to this device', body: push.unsubscribeSchema },
  // ---------------------------------------------------------------- safety
  'POST /v1/reports': { tag: T.safety, summary: 'Report a person, activity, trip or message', body: safety.reportSchema, returns: '{ id, status, priority, expectedWithin, coverage, emergency }. Category immediate_danger and physical_safety are urgent: looked at first, and immediate danger alerts every moderator at once. The answer also carries the emergency number to show the person.', errors: ['RATE_LIMITED'] },
  'GET /v1/reports/policy': { tag: T.safety, summary: 'How reports are handled: coverage hours, answer times and the emergency number', returns: '{ coverage: { text, onDutyNow }, answerWithin: { urgent, normal }, emergency: { number, text } }. Public.' },
  'GET /v1/me/reports': { tag: T.safety, summary: 'Reports I made and where each stands', returns: page + ' Each item: { id, category, targetType, status, outcome, createdAt, canAppeal }, newest first. A dismissed report can be appealed once with POST /v1/me/appeals (kind report).' },
  'GET /v1/blocks': { tag: T.safety, summary: 'People I have blocked, newest first', returns: page + ' Each item: { userId, displayName }.' },
  'POST /v1/blocks': { tag: T.safety, summary: 'Block a person (works across HERE and THERE, ends any follow)', body: safety.blockSchema, errors: ['INVALID_TARGET', 'NOT_FOUND'] },
  'DELETE /v1/blocks/{userId}': { tag: T.safety, summary: 'Unblock a person' },
  'POST /v1/follows': { tag: T.safety, summary: 'Follow a person (mutual follows are buddies)', body: follows.followSchema, errors: ['INVALID_TARGET', 'NOT_FOUND', 'RATE_LIMITED'] },
  'DELETE /v1/follows/{userId}': { tag: T.safety, summary: 'Stop following a person' },
  'GET /v1/me/connections': { tag: T.safety, summary: 'My buddies, following or followers (private lists)', query: z.object({ kind: z.enum(['buddies', 'following', 'followers']).optional(), limit: z.coerce.number().int().optional(), cursor: z.string().optional() }), returns: page },
  'GET /v1/retention': { tag: T.auth, summary: 'What the app keeps and for how long, in plain words (privacy information)', returns: '{ items: [{ what, kept, why }] }. Public; the periods follow the server settings.' },
  'GET /v1/openapi.json': { tag: T.docs, summary: 'This document (OpenAPI 3.1), including the error-code list', returns: 'The OpenAPI document. Public.' },
  // ---------------------------------------------------------------- admin console (staff only)
  'GET /v1/admin/overview': { tag: T.admin, summary: 'Everything the Overview dashboard shows', returns: 'Counters (users, pending checks, open reports, active plans), real-member totals, identity approval rate, report counts by status, and the last 30 days as daily series (members, activities, trips, reports) with the previous 30 days for comparison, plus reports by category.' },
  'GET /v1/admin/users': { tag: T.admin, summary: 'Search people', query: z.object({ q: z.string().optional(), state: z.enum(['active', 'suspended']).optional() }) },
  'GET /v1/admin/users/{id}': { tag: T.admin, summary: 'One person: status, history and every report about them' },
  'POST /v1/admin/users/{id}/suspend': { tag: T.admin, summary: 'Suspend (timed, or until restored); open reports about them resolve automatically', body: admin.suspendSchema, errors: ['INVALID_TARGET'] },
  'POST /v1/admin/users/{id}/restore': { tag: T.admin, summary: 'Lift a suspension', body: admin.reasonSchema },
  'POST /v1/admin/users/{id}/mfa/reset': { tag: T.admin, summary: 'Switch off a staff member two-step sign-in (a lost phone); admin only', body: admin.reasonSchema, returns: '{ ok: true }. They set it up again at their next sign-in.' },
  'POST /v1/admin/users/{id}/role': { tag: T.admin, summary: 'Change a person\'s staff role (admin only)', body: admin.roleSchema, errors: ['ADMIN_ONLY'] },
  'GET /v1/admin/verifications': { tag: T.admin, summary: 'Identity checks by status', query: z.object({ status: z.string().optional() }) },
  'POST /v1/admin/verifications/{id}/decision': { tag: T.admin, summary: 'Approve or reject a manual identity check', body: admin.verificationDecisionSchema, errors: ['ALREADY_DECIDED'] },
  'POST /v1/admin/users/{id}/reset-verification': { tag: T.admin, summary: 'Let a person try verification again', body: admin.noteSchema },
  'POST /v1/admin/users/{id}/overturn-rejection': { tag: T.admin, summary: 'Approve a wrongly rejected person (under-18 results: admin only)', body: admin.noteSchema, errors: ['NOT_REJECTED', 'ADMIN_ONLY'] },
  'POST /v1/admin/users/{id}/require-reverification': { tag: T.admin, summary: 'Require a new identity check (security or fraud)', body: admin.reverifySchema, errors: ['ALREADY_VERIFIED'] },
  'GET /v1/admin/reports': { tag: T.admin, summary: 'The report queue: urgent first, then overdue and escalated', query: z.object({ status: z.string().optional(), category: z.string().optional() }), returns: '{ items }. Each has priority, ageHours, overdue, escalated, assignedName, subject (the person it is about), message (for message reports) and repeatOffender: { flag, reasons }.' },
  'GET /v1/admin/reports/workload': { tag: T.admin, summary: 'Moderator workload and queue health', returns: '{ policy, queue: { unassigned, urgent, overdue, oldestUnassignedHours }, moderators: [{ id, name, role, assigned, overdue, oldestHours, resolvedLast7Days }] }' },
  'GET /v1/admin/messages/{id}': { tag: T.admin, summary: 'A reported message with the messages around it', returns: '{ id, body, state, sender, scope, around }' },
  'POST /v1/admin/messages/{id}/remove': { tag: T.admin, summary: 'Hide a message from its chat (kept for the record). The sender is told why', body: moderation.removeMessageSchema, returns: '{ ok, state }. Open reports about the message are resolved.' },
  'POST /v1/admin/messages/{id}/restore': { tag: T.admin, summary: 'Put a hidden message back', returns: '{ ok, state }' },
  'POST /v1/admin/users/{id}/warn': { tag: T.admin, summary: 'Send a formal warning (can be tied to a report or message)', body: moderation.warnSchema, returns: '{ id, warningsInLastSixMonths, repeatOffender }. The person is told and can appeal it once.', errors: ['INVALID_TARGET', 'FORBIDDEN'] },
  'GET /v1/admin/users/{id}/offender': { tag: T.admin, summary: 'Repeat-offender check for a person', returns: '{ flag, reasons, warnings, reporters, suspensions }' },
  'POST /v1/admin/reports/{id}/assign': { tag: T.admin, summary: 'Take a report' },
  'POST /v1/admin/reports/{id}/resolve': { tag: T.admin, summary: 'Resolve, dismiss or mark a report in review', body: admin.resolveSchema },
  'GET /v1/admin/activities': { tag: T.admin, summary: 'HERE activities for moderation', query: z.object({ status: z.string().optional() }) },
  'POST /v1/admin/activities/{id}/remove': { tag: T.admin, summary: 'Remove an activity (members are told it was cancelled)', body: admin.reasonSchema },
  'POST /v1/admin/activities/{id}/members/{userId}/remove': { tag: T.admin, summary: 'Remove a member from an activity (access ends at once)' },
  'GET /v1/admin/trips': { tag: T.admin, summary: 'THERE trips for moderation', query: z.object({ status: z.string().optional() }) },
  'POST /v1/admin/trips/{id}/remove': { tag: T.admin, summary: 'Remove a trip (members are told it was cancelled)', body: admin.reasonSchema },
  'GET /v1/admin/audit': { tag: T.admin, summary: 'Read-only history of staff and safety actions', query: z.object({ objectType: z.string().optional(), objectId: z.string().optional() }) },
};
