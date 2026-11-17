# Usability audit — Build 73 (Nov 17, 2026)

**Method.** Every screen reachable in a simulated iPhone 13 was opened by script (73 screens: `tools/walk/audit.js`, `audit2.js`), its wording dumped and read, and tap-target sizes, small text, clipped text and sideways scrolling measured. Day and Night looks. Judged against the project goals: practical, fun, few hurdles for a beginner, plain wording, nothing hidden from an experienced observer.

**Not covered.** A real phone. Android. The check-up after its first screen. Finishing a race, the leaderboard, QR scanning. The object page (reviewed in earlier builds). Screen readers. Landscape.

**What is already good.** No script errors on any screen. No sideways scrolling. One clipped label in 73 screens. The look is consistent in Day and Night. Descriptions say what you will actually see ("Faint grey smudge — look slightly to one side of it"). The app admits guesses ("Suburban sky (a guess)", "compass guess"). The log and milestones are warm.

## A. Wrong or broken

1. **Nine Messier objects can never be rated, suggested or scored.** M22, M35, M62, M69, M70, M71 and M107 have no magnitude in the catalogue; M40 and M73 are types the rating skips. The Marathon therefore tops out at 101, not 110. 27 other objects also lack a magnitude, including Caldwell 9, 49, 68 and 99.
2. **Location is never asked for.** The app silently uses Toronto. The start-screen line ("Dark now, until 5:35 a.m.") and the alignment stars are computed for it. The only prompt is a "Location not set" strip on Find. Far from Toronto, alignment stars would be shown in the wrong place.
3. **The iPhone "motion blocked" help tells people to delete website data,** which erases their log, plans and places. There is no backup.
4. **"Simulate sensors (desktop testing)" is shown to every Android user** on the start screen (`if (!IS_IOS)`).
5. **"Caldwell 14 Double Cluster" appears twice** in suggestions (two catalogue entries, one name).
6. **Plan times are "looks best" times, not when you will get there.** M57 and M15 both read "8:45 p.m." in the list; the route preview gives different times for the same stops.
7. **The route preview shows alignment stars even when already aligned.**
8. **Screens keep the previous scroll position.** Entering the Marathon from a scrolled lobby hides the sync-star explanation above the top of the screen.

## B. Hurdles for a first-timer

9. **The Observe path is long before the first star:** a 4-minute check-up that needs a table and a distant landmark, then Blocked sky, then alignment. The check-up's first screen shows "Phone make & model", "Grade against eyepiece", "Gyroscope: present", "Update rate", "Compass: Android rotation vector".
10. **The Blocked sky step leads with naming a place** and a "Show on star maps" switch, before the one action that matters (Trace the skyline).
11. **The Alignment screen is an engineering page.** Before the first star it already shows Start over, Undo last sync, Save tilt, Alignment details and Choose any star. After aligning it shows a residual table, "Sky consistency — errors ×10", "Leftover error (RMS / worst)", "Worst pair-distance mismatch" and a 90-word paragraph. All of that belongs behind one "Details" fold.
12. **The Plan page is 4,000–5,300 px tall.** The name-and-notes card appears before any plan exists, and 198 suggestions follow.
13. **An automatic 2-hour plan had 8 targets and 4 sync stars:** 12 stops, a third of them not sights.

## C. Wording

14. **One thing, several names.** Observe (start) = Push (tab). Play (start, screen title) = Game (tab). Explore = Sky view. Alignment / Align / Star alignment. Phone check-up / Test / "Phone not tested yet".
15. **Notation with no explanation:** the ●●● dots on Find have no key; "mag 8.8 · 1.3′ · Lyra"; ′ and ″; "Fit 0.4′"; "NGC 1039 · Per"; "route 239° of slewing"; "challenge QSCPSG"; M73 typed as "Other".
16. **Uneven precision:** "87.9° away" and "100.8° away" in the games; whole degrees elsewhere.
17. **For experienced observers:** Numbers gives height and direction only. No RA/Dec, no rise, transit or set times, no surface brightness.

## D. Feel

18. **Small touch targets.** Header buttons and every small button are 36 px tall, tick boxes are 22 px, and the "on Deneb" link is 17 px. Apple's guide is 44. This matters most in the dark with cold hands.
19. **Five system pop-up boxes** (rename a place, rename a plan, name a place, paste a code). They are unstyled and bright white at night.
20. **Toasts cover content for 4–5 seconds** (the night-look nudge sits on the alignment result; "Plan built" sits on the plan).
21. **Two "did you see it" controls on the observing screen:** "See it? Yes / Not sure / No" and the Log button's "Saw it ✓ / Not sure / No".
22. **The back button says "‹ More" on Alignment** even when you arrived from the start path or the header.
23. **Plan Edit mode squeezes names** behind four controls (↑ ↓ ✕ ≡).
24. **A Marathon with nothing found lists all 62 objects as "Not found".**
25. **More menu gaps:** no backup, no help (How it works lives only on the start screen), no contact or feedback, no build number. "Day look (off = Night, red only; the sun/moon button fades between them)" is hard to parse.
26. **Setup:** eyepiece table headed "AFOV°, Field, Cycle"; the drift-timing calculator sits in the main view; a sourcing-guide line under the focuser picture.

---

# What Build 74 did about it (Nov 17, 2026)

Checked by re-running the full walk (62 screens, no errors) plus `tools/walk/b74.js`. Simulator only.

| # | Finding | Status |
|---|---|---|
| 1 | Nine unrated Messier objects | **Fixed.** Magnitudes added for M22, M35, M62, M69, M70, M71, M107 (standard catalogue values, from memory, not looked up). M40 is rated as a double, M73 as an asterism. All 110 are now rated. Caldwell 9, 49, 68, 99 still have no magnitude. |
| 2 | Location never asked | **Fixed.** Asked before the first activity: this phone's location, type it in, or "Not now (use Toronto)". The start-screen line says when it is still worked out for Toronto. |
| 3 | iPhone help erases data | **Partly.** Backup and Restore added (More, and a "Back up my data first" button in that help). The help still tells people to delete website data, because that is the known way to get the motion prompt back; it now warns what is lost. |
| 4 | Simulate button on Android | **Fixed.** Shown only with `?sim` in the address. |
| 5 | Double Cluster twice | **Fixed** (second half is no longer suggested separately). |
| 6 | Plan times | **Fixed.** Plan rows show "about 9:07 p.m." — when you will reach it — from the same clock as the route preview. |
| 7 | Preview shows alignment stars when aligned | **Fixed.** |
| 8 | Scroll position kept | **Fixed** for the Marathon start and finish. |
| 9 | Long first-run path | **Changed.** The phone check-up is now optional by default (star unlit, labelled optional). Its first screen folds the sensor rows under "Options and sensor details". A first Observe run is Blocked sky, then Star alignment. |
| 10 | Blocked sky step leads with place naming | **Fixed.** Trace first; "This place" and the show-on-maps switch come after. |
| 11 | Alignment is an engineering page | **Fixed.** One "Details and tools" fold holds the fit table, sky consistency, Start over, Undo, Save tilt and star picker. Column heads are Height and Off by. |
| 12 | Plan page length | **Improved.** Name-and-notes card appears only once the plan has something in it; suggestions start at 15, not 40. An empty plan page went from 4,265 px to 1,914 px. |
| 13 | Too many sync stars | **Improved.** Sync-star distance raised from 40° to 50° (plans and Marathon); with the new ordering the same 8-target plan has 1 sync star, not 4. The 50° figure is a judgement, untested on real hardware. |
| 14 | One thing, several names | **Mostly.** Tabs are now Observe and Play. "Star alignment" everywhere. "Phone check-up" everywhere. Explore still opens a screen titled "Sky view". |
| 15 | Notation with no key | **Fixed** on Find ("What the dots and numbers mean"). Race wording simplified. M73 is an asterism. |
| 16 | Uneven precision | **Fixed.** Whole degrees from 10° up. |
| 17 | For experienced observers | **Partly.** RA, Dec and size are in Numbers. Rise, transit and set times are not. |
| 18 | Small touch targets | **Fixed.** Small buttons, chips, header buttons and back buttons are 44 px; tick boxes 28 px in 44 px rows. |
| 19 | System pop-ups | **Fixed.** All five use the app's own dialog. |
| 20 | Toasts cover content | **Partly.** Tap a toast to dismiss it. They still sit over content. |
| 21 | Two "did you see it" wordings | **Fixed** (both say "Saw it ✓ / Not sure / No"). Both controls remain. |
| 22 | "‹ More" back button | **Fixed.** "‹ Back" returns to where you came from; hidden during the start path. |
| 23 | Plan Edit mode squeeze | **Not done.** Waiting on a real-phone test of dragging before removing the arrows. |
| 24 | Blank Marathon summary | **Fixed.** |
| 25 | More menu gaps | **Mostly.** Backup added, build number shown, Day look reworded. No help or feedback entry. |
| 26 | Setup wording | **Mostly.** Eyepiece table explained and re-headed; the drift calculator is folded away. |

Also changed: a pair of faint stars (M40) is never rated "Obvious".
