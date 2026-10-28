# Data Protection Impact Assessment (DRAFT)

**Product:** HERE & THERE (one account, two modes: HERE = activities in the next hours; THERE = trips and travel buddies)
**Controller:** [COMPANY NAME, ADDRESS] **DPO / contact:** [EMAIL]
**Prepared:** 2026-10-26, from the code. **Status:** draft for the DPO to complete, score and sign. Not legal advice. Items marked **[CONFIRM]** need a human decision.

## 1. Why a DPIA
The product (a) brings strangers together in person, (b) verifies identity with documents and, optionally, a face match (biometric data, Art. 9), (c) processes location (venues, and a person's approximate position on request), (d) orders content by profile, and (e) may involve people who are vulnerable to abuse. Several of these are on the usual lists that call for a DPIA (Art. 35(3) and the supervisory authority's lists) **[CONFIRM]**.

## 2. The processing
- **What:** account and profile data; identity-check outcomes (not documents, selfies or face data); optional mobile number; plans and trips; requests; group chat; follows and blocks; alerts; safety reports; audit log. Full table: [data-inventory-and-lawful-basis.md](data-inventory-and-lawful-basis.md).
- **Whose:** adults (18+) who sign up in Italy and elsewhere in the EU **[CONFIRM countries]**.
- **How much:** pilot scale first (Milan), designed for thousands of users.
- **Recipients:** an identity provider (Persona in its sandbox for testing only; iDenfy built as the alternative), email, SMS and push services, map tiles, a place-search service (words typed and the city, no account id), hosting. None chosen for production yet.
- **Retention:** [retention-schedule.md](retention-schedule.md).

## 3. Necessity and proportionality
| Question | Current answer |
|---|---|
| Is each piece of data needed? | Identity data is reduced to the outcome. Location is not tracked: the phone's position is used only when tapped, rounded to ~1 km, never stored. The mobile number is optional. |
| Is there a less intrusive way to reach the same aim (safe in-person meetups)? | Yes, partly, and it is offered: the **document-only** check has no face match. Browsing needs no verification. |
| Lawful basis | See the inventory. The face match rests on **explicit consent**, so consent must be free: hence the alternative path and no penalty for choosing it. **[CONFIRM]** whether an alternative of equal standing is enough, and whether the safety purpose can support a different basis. |
| Transparency | Privacy notice and terms drafted but **not yet shown in the app**. Must be live before real users. |
| Data subject rights | Access/portability, rectification, erasure built. Restriction/objection by support only. Withdrawal of the face-match consent: delete account or use the document path; there is no "withdraw only this" button **[CONFIRM]**. |
| Processors | No contracts yet. Persona is connected for testing with fictional data only (iDenfy is built but untried); the chosen provider's data processing agreement must be signed before any real person is checked. |
| International transfers | Not assessable until providers are chosen. |

## 4. Risks and measures
Likelihood and severity are for the DPO to score (Low / Medium / High) **[CONFIRM]**. "Residual" is after the measures already built.

| # | Risk to people | Measures built | Still open | Residual |
|---|---|---|---|---|
| 1 | **Leak of identity data** (documents, selfies, face templates) | We never receive or store them; only the outcome. Our code asks the provider to redact the inquiry (images, selfie, name, birth date) as soon as the decision is in. Staff see no documents. | A real provider's own security and EU hosting must be checked in the contract; what the provider keeps despite redaction must be confirmed in writing. | [score] |
| 2 | **Biometric processing without a free choice** | Explicit consent screen; a document-only alternative; consent time stored and logged. | Legal opinion on consent validity: a 2026 Garante decision held consent invalid where the service cannot be used without it, and our verification is needed to join, host or chat (see Italy note 1 in the face-matching checklist). | [score] |
| 3 | **Wrongly refused or blocked** (the age check says under 18, or a document is unreadable) | Retries allowed (5 a day); staff can reset or overturn a rejection; under-18 results reviewable by an admin. | No in-app appeal; no published review time. | [score] |
| 4 | **Stalking or harassment** through profile, chat, location | Public venues only, never homes or live location. Private follow lists. Blocking (hides both ways). Reporting with a moderation queue; suspension; bans that remember email, number and device (hashes). Two-step sign-in for staff. | Moderator staffing and response times are a process matter. | [score] |
| 5 | **Account takeover** | Passwords hashed; reset by emailed code; changing a password signs out every other device; the owner is emailed on password, email or deletion changes; rate limits; staff two-step sign-in. | Optional two-step sign-in for ordinary users is not built. | [score] |
| 6 | **Excessive retention** | A daily job deletes old chats, alerts, closed reports, audit rows and old identity-check history. | Periods to be approved by the owner/DPO. | [score] |
| 7 | **Profiling and filter bubbles** | The ordering uses simple, visible signals; it removes nothing; time-ordered views exist. | Explain it in the privacy notice. | [score] |
| 8 | **Minors using the service** | 18+ self-confirmation, then provider age check before any meeting or chat. | The provider's age assurance level must be checked. | [score] |
| 9 | **Phone number exposure** | Encrypted at rest; a keyed fingerprint (not the number) is used to stop duplicates; shown to nobody but the owner, masked. | Key management in production (a secret store, rotation) **[CONFIRM]**. | [score] |
| 10 | **Erasure incomplete** | Account deletion erases personal fields, messages, follows, favourites, alerts, identity history, tokens; keeps only a bare "Deleted user" row and what safety law or moderation needs. | Backups: deletion must also age out of backups (none exist yet). | [score] |
| 11 | **Ranking exposes who you follow** | Follow lists are private; the feed returns only a count of followed people going. | None known. | [score] |
| 12 | **Children or vulnerable people lured via trips** | Trips are proposals, not bookings; budgets are estimates; no payments are taken in the app. | Terms should repeat the safety guidance. | [score] |
| 13 | **Unfair or retaliatory reliability level** (a host marks someone out of spite; a spiteful report; a low level shown to everyone verified) | A level counts only verified, completed plans. A host's note counts for nothing until the member had 7 days to dispute it or a moderator upheld it; hosts can only note people who were approved, from the plan's start to 48 hours after its end, at most 40 notes a day; the member is told at once; disputes go to a moderator who can overturn any note later; reports never count until a moderator resolves them; new people start as "New"; old events fade and drop out after 2 years; the app shows only the level, but the person can dispute any note and can download every event and the history of changes; at most 2 plans a day count. | No appeal of the level itself beyond disputing notes; the app does not explain a level in detail on screen (the breakdown is in the data download), which should be checked against the transparency duties; no check for hosts who mark unusually many people; showing "Needs care" to all verified members should be reviewed **[CONFIRM]**. | [score] |
| 14 | **Shared links expose plan details to people outside the plan** | The link page shows only the title, day and city of a public plan that is still on; a cancelled, finished, invite-only or missing plan gets the same "not available" page; no venue, host or member names; no scripts; not indexed by search engines; titles shown as plain text. | The title is written by the host and is public by design. | [score] |
| 15 | **Typed place searches go to a third party** | Only the words typed and the city leave our server, with no account identifier; searches are rate limited and not stored. | The public OpenStreetMap service is not meant for production traffic; a hosted or self-hosted geocoder will be a processor needing a contract. | [score] |
| 16 | **A forged or replayed provider message marks someone verified** | The provider's webhook signature is checked (secret rotation supported), messages older than 5 minutes are refused, a repeat changes nothing, and an approval counts as adult only when the birth date shows 18 or over. | None known. | [score] |

## 5. Security measures (Art. 32), as built
Transport security is a deployment matter (HTTPS required in production). In the code: password hashing; per-user token revocation; role-based staff access, with every staff action in the audit log; encrypted phone numbers and staff authenticator secrets (AES-256-GCM, keys from the environment); rate limits on sign-in, codes, exports and deletions; data minimisation in identity checks (proved by a test: personal data in a provider message is dropped, never stored); signed provider webhooks (with a 5-minute replay window); an "adult" answer is never assumed without proof; security headers and a strict content policy on the public link pages.

## 6. Consultation and sign-off
- Data subjects or their representatives consulted: **[none yet]**
- DPO advice: **[pending]**
- Prior consultation with the Garante (Art. 36) needed? Only if high residual risk remains: **[CONFIRM]**
- Approved by: [name, role, date]. Review again when a real provider is chosen, when marketing or analytics are added, or yearly.
