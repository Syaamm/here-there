# HERE & THERE: privacy and compliance pack (DRAFT)

**Status: working drafts, not legal advice.** They describe what the product actually does today (written from the code, not from plans) so that a lawyer or Data Protection Officer can review, correct and sign them. Nothing here has been approved. Every point that needs a human legal decision is marked **[CONFIRM]**.

| File | What it is | Who needs to act |
|---|---|---|
| [data-inventory-and-lawful-basis.md](data-inventory-and-lawful-basis.md) | Every kind of personal data, why it is held, the proposed lawful basis (GDPR Art. 6 / 9), who sees it, how long it is kept | Lawyer/DPO confirms each basis |
| [dpia-draft.md](dpia-draft.md) | Data Protection Impact Assessment (Art. 35): risks and the measures already built | DPO completes the risk scoring and signs |
| [face-matching-checklist.md](face-matching-checklist.md) | Biometric (face match) identity check: what Italian law and the Garante expect (with the 2026 findings), the provider shortlist and the questions to ask a provider, and what is and is not in place | Lawyer decides; do this BEFORE a real provider is switched on |
| [retention-schedule.md](retention-schedule.md) | How long each kind of data is kept (matches the clean-up job in the code) | Owner approves the periods |
| [moderation-policy-draft.md](moderation-policy-draft.md) | How reports, warnings, escalation and appeals work (hours, answer times, emergency path) | Owner approves the hours and answer times |
| [privacy-policy-draft.md](privacy-policy-draft.md) | Plain-language privacy notice for the app | Lawyer edits; fill the [PLACEHOLDERS] |
| [terms-draft.md](terms-draft.md) | Plain-language terms of use and community rules | Lawyer edits; fill the [PLACEHOLDERS] |

## What the product already does for privacy (built and tested)
- Everyone can browse; verification is needed only to join, host, apply or chat.
- Identity data is minimised: only the outcome, a provider reference, the check type and timestamps are stored. Never a document, selfie, name or birth date.
- Two kinds of identity check: document + selfie (biometric, explicit consent) and **document only** (nothing biometric).
- A person can download all their data, correct it (profile, email, password) and delete their account (erasure, immediate).
- Phone numbers are encrypted in the database; one number can belong to one account.
- Staff sign-in supports two-step codes (authenticator app); in production it is required.
- A retention job removes old chats, alerts, closed reports, audit rows and identity-check history on a schedule.
- Locations: a person's own position is used only when they tap "Near me" or "How far?", is rounded to about 1 km and is never saved.
- Drafts are private to the person and are saved on leaving a form or the app; a form left empty saves nothing.
- A shared plan link shows only the title, the day and the city of a public plan that is still on.

## What is NOT done (honest list)
- No real identity provider is **in use** yet. A Persona adapter is built (it keeps no ID image, selfie, name or birth date, and has the inquiry erased at Persona once the outcome is held) and is connected to a Persona sandbox for testing with fictional data only; no real person has been checked. The provider contract, data-processing agreement, EU data storage and the face route's consent wording are open.
- The meeting-place search sends the words typed and the city to a map service (today the public OpenStreetMap geocoder, which is not meant for production use). A production provider will need a contract; see the recipients table in the data inventory.
- Terms, privacy notice and consent screens are not yet shown in the app (the drafts here are the text to put in).
- No separate marketing/analytics consent exists because there is no marketing or analytics in the product yet. **[CONFIRM]** before adding either.
- No appeal route for a rejected identity check beyond contacting support; staff can overturn a rejection.
- Right to restriction/objection has no self-service screen (handled by support today).
- Hosting, email, SMS and push providers are not chosen for production, so international-transfer analysis cannot be finished.
