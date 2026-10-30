# On-call process for urgent reports (DRAFT: the owner must decide the items marked [DECIDE])

Software can tell people something is urgent. It cannot make a person pick up a phone. This page is the plan for the humans: who is on call, what they do, and what happens when nobody answers. The code carries out exactly what is written here (`services/api/src/moderation/oncall.ts`, `moderation.controller.ts`); change the text and the code together.

## What counts as urgent
- **Someone is in danger right now** (`immediate_danger`): at any hour.
- **Physical safety** (`physical_safety`): urgent for the queue; staff are paged **only outside coverage hours** (when nobody is expected to be at the console).
- Everything else is normal and never pages anyone.
- Reports are **not** an emergency service. Every report screen and confirmation shows the emergency number (112) first. Moderators never tell a person "wait for us" when someone may be in danger: they tell them to call 112.

## The rota
- Administrators set shifts in the admin console (Reports, On-call). A shift is one person, a start and an end, at most 14 days.
- Only active moderators, trust leads and administrators can be on call. Each person on call needs a **confirmed mobile number** (Settings, Mobile number): that is how the text reaches them. The console warns when someone on call has none.
- When no shift covers the moment, the **trust leads and administrators are on call** (the console says so in a warning). That is a safety net, not a plan.
- **[DECIDE]** Who is on call, and when? Minimum: one named person at every hour. Suggested: one person per 12-hour shift, handing over at 08:00 and 20:00 Milan time, and a named backup.
- **[DECIDE]** The owner contact (`ON_CALL_OWNER_EMAIL`, `ON_CALL_OWNER_PHONE`): a person or shared inbox/number that is not tied to one shift. It is the last step below.

## What happens, step by step
| When | What the software does | What the person does |
|---|---|---|
| 0 minutes | Immediate danger: every moderator is alerted in the app; the people on call get a push, an email and a text. Physical safety out of hours: the same for the people on call. | Open the reports queue, **take the report** (Assign to me). That is what "answered" means. |
| 15 minutes **[DECIDE]** | Nothing automatic. | The on-call person should have taken it. If they cannot, they hand over to the backup by phone, not by waiting. |
| 1 hour | Nobody took it. Trust leads, administrators and the on-call people are alerted by every channel. **The person who reported is told** we have not answered yet, and is reminded to call 112 if anyone is in danger. | A trust lead or administrator takes the report or phones the on-call person. |
| 2 hours | Still nobody took it. **Every administrator and the owner contact** are alerted by every channel, marked CRITICAL. | The owner contact decides: take it themselves, call the on-call person, or call the police/112 about a situation described in the report. |
| After 2 hours | Nothing more is sent automatically (more messages would only add noise). The report stays at the top of the queue, marked critical. | A person must act. |

If a moderator has taken the report, the 2-hour step does **not** happen (someone is on it). The 1-hour step is about the answer time: a taken but unresolved urgent report still tells the senior staff once.

The checks run every 5 minutes, so a step can be up to 5 minutes late.

## The decision that is a person's, not code: "what if nobody answers in an hour?"
The software's answer is the table above. The owner must confirm each of these, because they decide who gets woken up:
1. **Is one hour the right time to widen the page?** (Shorter wakes more people for reports that turn out to be nothing; longer leaves a person in danger waiting.) Suggested: keep 1 hour.
2. **Who is the person at the end of the chain**, and will they really answer a text at 03:00? If the answer is "nobody", say so here and make sure the report screen's emergency number text is kept prominent: that is then the only real safety net.
3. **Does a person on call get time off the next day?** (A rota that burns people out fails exactly when it is needed.)
4. **May staff phone the person who reported?** If so, from which number, and what may they say? (Suggested: only from the company number, only to ask whether they are safe and to repeat 112, and log it.)
5. **When is a report passed to the police?** (Suggested: when a moderator believes someone is in immediate danger and the person who reported cannot be reached. Needs the lawyer's opinion on what may be shared.)

## After an urgent report
- Resolve or dismiss it with a note (the note is for staff; the person who reported sees only "we took action" or "we found nothing to act on").
- If it reached the 1-hour or 2-hour step, a short written review within 3 working days: why did nobody take it, and what changes? **[DECIDE]** who writes it.
- The audit trail has every page (`report.oncall_paged`, with how many people and by which channels) and every escalation (`report.escalated`, level 1 or 2).

## What the message contains
Emails and texts say only that an urgent report is waiting, give a link to the admin console and (for an escalation) how long it has waited. They **never** contain what the report says or who it is about: phones and mailboxes are not a safe place for that.

## Needed to switch this on for real
- An SMS provider (Twilio settings in `docs/FOR_DEPLOYMENT.md`) and an email sender; without them texts and emails only print in the console.
- `ADMIN_URL` (the link in the messages), `ON_CALL_OWNER_EMAIL`, `ON_CALL_OWNER_PHONE`.
- Staff push needs the staff app/browser to be subscribed; do not rely on push alone.
- A drill: before launch, create a test urgent report on a staging server at an unusual hour and check that the on-call person's phone really rings, then leave it untaken and check the 1-hour and 2-hour steps arrive.
