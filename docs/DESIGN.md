# The Figma design in the app

Status: 3 November 2026. The mobile app is being rebuilt to match the finished Figma design. **HERE is finished** (design pages 1 to 38). **THERE is partly done** (pages 40 to 77). Everything here is uncommitted until the owner commits, and none of it has been tried on a phone yet (only in a browser).

## Where the design is

- Figma file: "HERE & THERE MOBILE APP (Copy)", key `P3nn0lh71eKnShIY6WwIPD`. The original (`6U9vJB8XT8ESQlY7FkxAB3`) is view-only for Claude's Figma connector, so the copy was used.
- The Figma connector is on a Starter plan with a small read limit, which ran out within one session. **Work from the PDF export instead:** "HERE _ THERE MOBILE APP (Copy).pdf" (kept in the owner's Downloads folder). It has 77 pages, each one phone screen of 402 x 874, the same size as the Figma frames, so text sizes, colours and positions in it are exact.
- Page ranges: 1 to 38 HERE, 39 the type and colour guide (Inter; #102F29 forest, #E9E5DD ivory, white), 40 to 77 THERE.
- Reading the PDF: `pymupdf` (`import pymupdf`) renders a page (`doc[n-1].get_pixmap(matrix=pymupdf.Matrix(2,2)).save(...)`) and gives text spans with size and position, shapes with their fill colours, and the images (`page.get_image_info(xrefs=True)`, `doc.extract_image(xref)`). Photos used in the app were taken from the PDF this way and shrunk to small WebP files.
- Browser check: the web preview (Metro, port 8082) with the API on 3000, driven by `puppeteer-core` and the installed Chrome at 402 x 874. To open the app in THERE mode as a returning visitor set `localStorage` keys `ht_mode` = `there` and `ht_intro` = `1` before loading. The helper scripts lived in the session scratchpad and are not in the repo.

## Rules that were followed

1. **Every screen keeps what it did before.** Only the look and layout changed. Where the design drops something the logic needs (a tick box, a banner, a link) it is kept in the same style. Where the design shows something the app has no data for, it was left out, not faked (list below).
2. **The system font stays.** The design uses Inter; the app uses the phone's own font everywhere. Sizes and weights come from the design (400, 500, 600, 700). Adding Inter is a small change but touches every screen.
3. **Readable text.** The design's very light grey text (40% black) is replaced by the app's normal grey (`c.muted`), and "spots left" green is `#2E7D32` instead of `#43A047`, so small text passes contrast.
4. **Colours come from theme tokens** (`useTheme().c`), never hard-coded, so HERE (white and forest) and THERE (ivory, white cards) both work. THERE's `surface` token is now white, as the design's cards and fields are.
5. **Every text goes through `t('English text')`**, with Italian in `src/lib/i18n/it/*.ts` (files: auth, home, create, inbox, details, account, accountSafety).
6. **One codebase for both products.** Shared screens read `useTheme().mode`; HERE must not change when THERE is worked on.
7. Standing UI rules still apply to every change: touch targets of at least 44 px, screen-reader labels, text on every chip, designed loading, empty, error, disabled and offline states.

## Page to screen map (all paths under `frontend/mobile/src`)

| PDF page | Screen | Main files |
|---|---|---|
| 1, 40 | Welcome (HERE and THERE) | `app/(auth)/welcome.tsx` |
| 2, 41 | Create your account | `app/(auth)/register.tsx`, `components/AuthForm.tsx` |
| 3, 42 | Welcome back (login) | `app/(auth)/login.tsx`, `components/AuthForm.tsx` |
| 4 to 6 | HERE onboarding: interests, city, languages | `app/onboarding.tsx`, `components/OnboardingParts.tsx` |
| 46 | THERE onboarding: travel vibe | same files |
| 7 | HERE Home | `features/ExploreHere.tsx`, `components/HereHeader.tsx`, `CategoryChips.tsx`, `Cards.tsx` (`ActivityBigCard`), `TabHeader.tsx` (`ModeTabs`), `ui.tsx` (`Screen` `headerBg`, `SearchBar`), dock in `app/(tabs)/_layout.tsx` |
| 8 to 11 | Create activity, 4 steps | `features/CreateActivity.tsx`, `components/CreateParts.tsx` |
| 12, 13 | Activity detail | `app/activity/[id].tsx`, `components/ActivityParts.tsx` |
| 14 | Manage join requests | `app/host/[id].tsx` |
| 16, 17 | Inbox: alerts, chats | `features/Inbox.tsx` |
| 18, 19 | Chat | `app/chat/[id].tsx` |
| 20 | Group info | `app/group/[id].tsx` |
| 21 | Map | `features/MapHere.tsx`, `MapHere.web.tsx`, `mapShared.tsx` |
| 22 | Settings | `app/settings.tsx` |
| 23, 68 | Profile | `features/Profile.tsx`, `components/ProfileParts.tsx` |
| 24 | Edit profile | `app/edit-profile.tsx` |
| 25 | Notifications | `app/notification-settings.tsx` |
| 26 to 32 | Change password, change email, safety, blocked and reports, review of decisions, get verified, travel buddies | `app/change-password.tsx`, `change-email.tsx`, `safety.tsx`, `reports-blocked.tsx`, `appeal.tsx`, `verify.tsx`, `travel-match.tsx`, `components/AccountParts.tsx` |
| 33 to 36 | First-launch intro (4 photos, slide to continue) | `app/(auth)/intro.tsx` |
| 37 | HERE / THERE chooser | `app/(auth)/choose.tsx` |
| 47, 53 to 56 | THERE Home, search, filter | `features/ExploreThere.tsx`, `SearchThere.tsx`, `components/ThereParts.tsx`, `Cards.tsx` (`TripBigCard`, `TripRow`) |
| 57 to 61 | Create trip, 4 steps | `features/CreateTrip.tsx`, `components/TripCreateParts.tsx` |
| 52, 69 to 77 | THERE settings and account pages | the same files as pages 22 to 32, with THERE colours |

**First launch (new):** a first-time visitor sees the intro, then the chooser, then Welcome in the product they picked. It is shown once per phone (`AsyncStorage` key `ht_intro`). Welcome draws a plain screen until it knows whether the intro was seen.

## Left out on purpose (no data or feature behind it)

- Create activity: the map under the place step.
- Group info: Mute. Chat: emoji reactions and read ticks. Chats tab: the filter button.
- Notifications: "Pause all notifications". Profile: the "4.8 reviews" line, avatars on the Travel buddies card.
- Safety: "Ghost mode". Blocked people: a "Block user" row (blocking is done from profiles).
- Get verified: the illustration (no asset).
- Create trip: the second budget handle, the Food and Stay toggles, the review photo and price breakdown. The budget slider on the search filter has one handle because the server takes only a ceiling.
- Trips have no photos in the API. THERE cards show the picture of the trip's first travel style (adventure, nature, beach, photography) or a plain sand tile, never a named place.
- THERE onboarding pages 43 to 45 (destination wishlist, travel dates, travel companions): the profile has no fields to save them (it has `homeCity`, `languages`, `interests`, `bio`, `displayName`). Decide whether to add backend fields.
- Page 38 (a collapsed variant of the chooser) and page 15 (a menu list) were not built.

## Design mistakes worked around

Email and Home City placeholders copy "Enter your name" / "Enter your password" (the app says "Enter your email" / "Enter your city"). Create activity step 4 reuses the step 1 title (the app says "Activity Size & Access"). Create trip review says "Step 2/4" (the app says 4/4). The chooser's "Find People and activites happen." has a typo and is the same under HERE and THERE (the app says "Find people and activities happen. Nearby. Soon."). Two labels in the activity detail rows look swapped; the real data is used.

## What is NOT finished (THERE)

- **Trip detail, manage trip join requests, trip plan, add a stop** (pages 62 to 67): started, **not finished or reviewed**. Files with partial edits: `app/trip/[id].tsx`, `app/trip-plan/[id].tsx`, `components/TripCalendar.tsx`, `components/TripParts.tsx`, `app/review/[id].tsx`.
- **THERE inbox, chat and trip group info** (pages 48 to 51): started, **not finished or reviewed** (`features/Inbox.tsx`, `app/chat/[id].tsx`, `app/group/[id].tsx` carry partial changes; HERE versions were not broken in the checks that were made).
- The THERE home filter button still opens the old time-window sheet; the full filter sheet is on the search tab.
- Nothing was seen on a real phone. Please check in Expo Go: the cards, the dock, the status-bar colour on HERE's dark header, the first-run intro and its slide control, and the keyboard on the new fields.

## Shared building blocks (for the next person)

`AuthForm` (round back button, heading, pill field, pill button, switch row, tick box), `OnboardingParts`, `HereHeader` (the dark band, with `Screen`'s `headerBg` so the page is a white sheet over it), `CategoryChips`, `Cards.tsx` (`ActivityBigCard`, `TripBigCard`), `CreateParts` and `TripCreateParts` (wizard top bar with step bars), `ActivityParts` (detail header, host card, info rows, who's-going circles), `AccountParts` and `ProfileParts` (title row, cards, rows with chevron circles), `ThereParts` (THERE header, search pill, chips, filter sheet pieces). Use these before inventing new ones.
