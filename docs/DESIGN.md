# The Figma design in the app

Status: 3 November 2026. The mobile app is being rebuilt to match the finished Figma design. **HERE is finished** (design pages 1 to 38). **THERE is built** (pages 40 to 77, none checked by eye against the PDF yet). Everything here is uncommitted until the owner commits, and none of it has been tried on a phone yet (only in a browser).

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
| 47, 53 to 56 | THERE Home, search, filter | `features/ExploreThere.tsx`, `SearchThere.tsx`, `components/ThereParts.tsx`, `Cards.tsx` (`TripBigCard`, `TripRow`) |
| 57 to 61 | Create trip, 4 steps | `features/CreateTrip.tsx`, `components/TripCreateParts.tsx` |
| 52, 69 to 77 | THERE settings and account pages | the same files as pages 22 to 32, with THERE colours |

**First launch (new):** a first-time visitor sees the intro, then goes straight to Welcome (which has its own HERE / THERE switch). The design's chooser pages (37 and 38) were removed on request: there is no chooser screen. It is shown once per phone (`AsyncStorage` key `ht_intro`). Welcome draws a plain screen until it knows whether the intro was seen.

## Left out on purpose (no data or feature behind it)

- Create activity: the map under the place step.
- Group info: Mute. Chat: emoji reactions and read ticks. Chats tab: the filter button.
- Notifications: "Pause all notifications". Profile: the "4.8 reviews" line, avatars on the Travel buddies card.
- Safety: "Ghost mode". Blocked people: a "Block user" row (blocking is done from profiles).
- Get verified: the illustration (no asset).
- Create trip: the second budget handle, the Food and Stay toggles, the review photo and price breakdown. The budget slider on the search filter has one handle because the server takes only a ceiling.
- Trips have no photos in the API. THERE cards show the picture of the trip's first travel style (adventure, nature, beach, photography) or a plain sand tile, never a named place.

## Design mistakes worked around

Email and Home City placeholders copy "Enter your name" / "Enter your password" (the app says "Enter your email" / "Enter your city"). Create activity step 4 reuses the step 1 title (the app says "Activity Size & Access"). Create trip review says "Step 2/4" (the app says 4/4). The chooser's "Find People and activites happen." has a typo and is the same under HERE and THERE (the app says "Find people and activities happen. Nearby. Soon."). Two labels in the activity detail rows look swapped; the real data is used.

## Added 4 November 2026

- Trip detail, manage trip requests, trip plan, add a stop (62 to 67) and THERE inbox, chat, group info (48 to 51) are built. Left out: the destination selector and the Where? field in the add-a-stop sheet, and the Includes label (no data).
- THERE onboarding pages 43 to 45 (wishlist, when, who with) are built, saved in three new private profile fields (travelWishlist, travelWindow, travelCompanions; owner-only, in the data export, erased on deletion). **A db:push is needed.** The design's progress bars repeat values, so the THERE bar fills evenly across six steps.
- Page 15 is the chat header popover menu; pages 37 and 38 (the chooser) are not built, by the owner's decision; the THERE home filter button opens the full filter sheet shared with search (`features/ThereFilters.tsx`).
- Still open: nothing has been seen on a real phone or compared with the PDF page by page; the design then needs tweaking and optimising.

## Added 5 November 2026

- Activity detail and trip detail now use a **fixed photo**: `Screen` has a new `fixedHero={{ photo, height, stop }}` prop (in `components/ui.tsx`). The picture never moves; the page is a card with a rounded top edge (28 px) that slides up over it and stops `stop` px from the top (below the buttons). While the card rises the picture grows a little and dims. The older `stickyHero` prop (two-piece sticky header) is no longer used by these pages.
- The fixed photo's grow and dim run on the native side: with `fixedHero`, `Screen` uses `Animated.ScrollView` and `Animated.event` with the native driver (the normal scroll code runs as its listener). Pages without `fixedHero` are unchanged.
- The card's top edge has the Profile page's soft fade: content slides up into the curve and melts away there. It is a fixed gradient whose opacity follows the scroll (hidden until the card has reached its stop line, so it never washes over the picture). The edge is not pinned; the card clips its own rounded corners.
- A fixed-picture page springs a little when pulled down at the top (iPhone bounce, Android stretch) and the picture eases larger and stays undimmed while pulled. Only the contents move: the card's colour and rounded top is its own layer (inside `Screen`'s `fixedHero` branch) that rises with the scroll to the stop line and ignores the pull.
- THERE Home: the "Explore The World Like Never" heading was removed from `features/ExploreThere.tsx`.

## Shared building blocks (for the next person)

`AuthForm` (round back button, heading, pill field, pill button, switch row, tick box), `OnboardingParts`, `HereHeader` (the dark band, with `Screen`'s `headerBg` so the page is a white sheet over it), `CategoryChips`, `Cards.tsx` (`ActivityBigCard`, `TripBigCard`), `CreateParts` and `TripCreateParts` (wizard top bar with step bars), `ActivityParts` (detail header, host card, info rows, who's-going circles), `AccountParts` and `ProfileParts` (title row, cards, rows with chevron circles), `ThereParts` (THERE header, search pill, chips, filter sheet pieces). Use these before inventing new ones.
