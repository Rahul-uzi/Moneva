# MONEVA — landing site

A single self-contained page introducing the app. No build step, no
dependencies, no framework: `index.html` holds its own CSS and JavaScript, so
it can be dropped on any static host as-is.

## Before you publish it

**Point the download button at a real APK.** Three links in `index.html` share
the same href:

```
downloads/moneva-v1.0.0.apk
```

Either put the APK at that path next to `index.html`, or replace all three with
an absolute URL (a GitHub Releases asset works well):

```bash
sed -i 's|downloads/moneva-v1.0.0.apk|https://github.com/Rahul-uzi/Moneva/releases/download/v1.0.0/moneva.apk|g' index.html
```

Search for `APK LINK` in the file — the comment marks the first one.

**Optional, in the hero and footer spec lines:** the file size and the minimum
Android version are not stated, because neither is recorded anywhere in this
repo (`apps/web/android/` is gitignored). Add them to the `.spec` paragraphs
once you know them — `APK · v1.0.0 · 14 MB · Android 8.0+` reads well.

## Running it locally

```bash
npx serve site
```

Or just open `index.html` in a browser — it needs no server.

## Deploying

Any static host serves it unchanged. GitHub Pages, Netlify drop, Cloudflare
Pages, or the same box as the API. The only external requests the page makes
are to Google Fonts for Manrope and JetBrains Mono, and both have local
fallbacks declared, so it still reads correctly if those are blocked.

## Building it

`index.html` is generated, not hand-edited. The sources live in the session
scratchpad and are stitched together by `build.mjs`, which also inlines the
font and the brand logos as base64 and runs seven structural guards (one of
which exists because a part file once closed `</style>` early and dumped the
whole phone stylesheet onto the page as visible text — tag *counts* balanced
perfectly, so the guards check *order*).

If you want to edit the page from here on, edit `index.html` directly; it is
self-contained and the build script is no longer needed.

## Typography

Three faces, each with one job:

| Face | Role | Delivery |
|---|---|---|
| **Archivo** variable (wdth 62–125, wght 400–900) | The whole site — display *and* running text | Google Fonts |
| **Manrope** 400–800 | Inside the phone only — the real app's face | Google Fonts |
| **JetBrains Mono** | Figures, labels, anything machine-shaped | Google Fonts |

Nothing is embedded. Everything is linked from Google Fonts, which is on the
Artifact sandbox's stylesheet allowlist, so the page carries no font payload at
all.

**On Monument Extended.** This direction came from Pangram Pangram's Monument
Extended, and that font is **free for personal use only** — commercial licences
are paid. A public marketing site for a distributed app is not personal use,
and embedding the file would redistribute it. Archivo stands in: it is OFL,
free for commercial use, and its variable width axis reaches **125%**, which
carries the same wide heavy grotesque character. If you buy a Monument licence,
swapping it in is a change to `--display` and the `<link>` in the head.

Archivo's width axis is used as a voice, not left at 100% everywhere. Three
registers:

| Register | Width | Used for |
|---|---|---|
| Condensed | 78–88% | Small uppercase labels, nav links — narrow reads as secondary and buys back horizontal room |
| Normal | 100% | Anything anyone has to actually read |
| Extended | 108–125% | Headings, buttons, wordmark, asserted figures — things that should be the loudest in their box |

Weights in play run 400 / 500 / 600 / 700 / 800 / 900. Display is
`font-stretch: 125%` at 800–900, uppercase, on a line-height below 1 — stacked
caps have no descenders to clear, and extended caps already read as loud, so
the tracking is pulled slightly negative. Running text stays at 100%: the
extended axis is for display only, and 125% at 16px is unreadable in a
paragraph.

Emphasis inside a headline is `.hl` — weight 900 in voltage. Never `<em>`.

**Manrope stays behind the glass.** The phone is a reproduction of the real
app, and the real app is set in Manrope. Restyling it would make the demo
misrepresent the product. The site speaks in Archivo; the product speaks in its
own voice.

Section titles are written short on purpose — two or three words a line.
Extended caps are wide, and a long sentence turns into a four-line wall.

## The feature list

Six features are a **numbered spec list**, not a card grid. The grid version
used `auto-fit` and left an orphan row — two filled cells beside two holes —
and six identical rounded rectangles gave no sense of which feature mattered.
A list has no orphan cells by construction and reads the way a spec sheet
does, which suits the display type.

Each row is `number · title · description` in three columns, collapsing to two
at 1020px and one at 560px, with the section's own word set vertically down the
margin. Hover draws a voltage edge down the row.

The **privacy list** had the same orphan-row fault and is fixed the same way —
six items in a *fixed* two columns is three even rows with no holes. It drops
the card chrome for hairlines and an icon badge, so it does not read as a
second copy of the numbered list above it.

Both are a reminder: `repeat(auto-fit, minmax(…))` is only safe when the item
count divides evenly into whatever column count it lands on. With six items it
almost never does.

## Measure

`--maxw: 1440px` inside a `clamp(18px, 3.2vw, 46px)` gutter. It was 1240px
inside 64px, which left 340px of dead margin either side of a 1920 screen.

**Widening the container is only half the job.** The first attempt at this went
to 1520px and looked worse, not better: `.split` was two equal `1fr` columns,
so on a wide screen the prose got ~700px to sit in while it is capped near
500px — and all that slack piled up between the two halves. The content ended
up flung to the left and right edges with a hole down the middle.

The fix is to size columns to their **content**, not to a fraction of the page:

```css
.split { grid-template-columns: minmax(0, 34rem) minmax(0, 1fr); }
```

The text column is now its own measure and the panel takes what is genuinely
spare, so the visual gap is the 62px column gap rather than 62px plus 200px of
nothing. `.split.stretch` keeps equal columns, because two cards of equal
weight really do want them.

The same logic put the privacy list on **three** columns rather than two — six
items divide evenly either way, but at 1440px two columns left each item
half-empty. Its inner `max-width` came off at the same time: once a column is
the right width, a second cap on the text inside it only makes another hole.

## The footer brand stack

**The footer is one frame.** `min-height: 100svh` on `.foot`, laid out as a
flex column: links at the top, the mark pushed to the floor by `margin-top:
auto` on the stack, legal bar underneath. Measured at 1366×768, 1440×900,
1920×800 and 1920×1080 — the footer height equals the viewport height exactly
at every one, so it never spills onto a second screen.

The header is `position: fixed`, so at the very bottom of the page it floats
over the footer's first rows. `.foot` therefore carries
`padding-top: calc(68px + …)` to clear it. Without that the links sat behind
the nav and the footer *read* as overflowing even though its height was
exactly one viewport.

**The reveal is scrubbed to scroll with GSAP + ScrollTrigger** (both pinned at
3.12.5 from cdnjs, which is on the Artifact sandbox's script allowlist).
`stagger: { from: "end" }` runs the cascade from the last element — the bottom
copy — so the solid base lands first and the echo climbs.

**The range is the whole trick.** Two earlier hand-rolled scrubs failed, not
because the maths was wrong but because the range was: the stack sits on the
*footer's floor*, so keying progress to either the stack's entry or the
footer's meant most of it elapsed while the mark was still under the fold. By
the time you could see anything, the bottom copies had already landed.

Anchoring `start: "top bottom"` (the mark's top touching the bottom of the
screen) to `end: "bottom bottom"` (its bottom reaching that same line) makes
the range **exactly the mark's own travel into view** — 430px, equal to its
height. Measured across it, the mark's top moves 900px → 470px, so it is on
screen for every frame of the progress, and the build finishes as the mark
finishes arriving. The end (7352) also lands before the document end (7433),
so the scrub always completes.

The CSS resting state is **visible**, and GSAP pushes the words down itself
before animating them back. That order is deliberate: if the CDN is blocked the
mark sits there fully drawn rather than being invisible forever.

The mark is sized `min(16.6vw, 30vh)`. The width term is what makes it
full-bleed (~93% of the viewport on normal ratios); the height term is the
ceiling — on a short or landscape screen the width-driven size would make the
stack taller than the frame it shares with the links and the legal bar, so
height wins there instead (70% at 1920×800).

Eight copies of the wordmark, stacked so the mark reads as an echo climbing
away from a solid base.

**How the occlusion works.** Each copy is absolutely positioned a fixed
distance off the floor of the stack (`--o`, in em) and painted in ascending
order (`--z`), so the *lowest* copy paints last, over everything above it.
Every copy is opaque, so each one hides the lower part of its neighbour above —
leaving only the band between them visible. The bottom copy has nothing below
it, so it stays whole.

**The offsets close up geometrically towards the top** (roughly ×0.72 per step,
largest gap 0.30em). That is what turns the upper copies into fine stripes
rather than an even ladder. An even spacing reads as a list; the closing curve
reads as motion.

Every offset is in `em`, so the whole construction scales from the single
`font-size` on `.brandstack`.

**The footer's background gradient runs through the mark, not behind it.**
`--foot-ramp` goes page-black → `--foot-1` at 44% → `--foot-2` (a deep,
voltage-tinted green) at the floor.

The obstacle: the eight line boxes must stay **opaque**, or the occlusion that
makes the echo collapses — so a gradient on `.foot` alone stops dead behind
them and shows as eight flat bands. The fix is that every line carries the same
`--foot-ramp`, sized to the footer's height and shifted up by its own distance
from the footer's top, so each shows exactly the slice of ramp it sits on and
the slices reassemble into one continuous gradient:

```js
line.style.backgroundSize     = "100% " + footerHeight + "px";
line.style.backgroundPosition = "0 " + (-offsetFromFooterTop) + "px";
```

Both values come from measured layout, so `paintFooterRamp()` reruns on resize
and once fonts settle. `.bs-line` also carries a flat `background-color:
var(--foot-2)` as the no-JS fallback — no gradient, but no banding either.

**The letterforms carry their own gradient** on top of that, via
`background-clip: text`, ramping `--ink-3 → --ink` — dim through the thin
stripes, full brightness on the solid base, so the mark lifts off the coloured
ground.

That text ramp spans the *whole stack* rather than restarting per line, by the
same slice trick in pure CSS (the stack's own height is a known `1.8em`, so no
measuring is needed):

```css
background-size: 100% 1.8em;
background-position: 0 calc((var(--o) - 1) * 1em);
```

It sits behind `@supports (background-clip: text)`, so a browser without it
keeps solid ink rather than invisible text.

It sits **below the link columns and above the legal bar** — the last thing on
the page, not a divider above the footer.

**The reveal is scroll-driven, bottom to top.** Each line clips its own word;
the word starts pushed down out of that clip and is driven up by scroll
position, staggered in reverse so the bottom line arrives first and the mark
builds upward. It is scrubbed rather than played — scrolling back up puts it
away again. Nothing loops or moves on its own. `prefers-reduced-motion` renders
it fully revealed and static.

Sizing note: "MONEVA" measures **5.66em** at weight 900 / width 125% with the
tracking used here, so the font-size is `16.5vw` — that lands the word at ~94%
of the viewport, full-bleed without clipping the M and the A against the edges.
Change the weight, width or tracking and that number needs recalculating.

## Voice — please keep it

The page is written for **anyone with a phone and a bank account**, not for
developers. The engineering is genuinely good, but a reader deciding whether to
install a money tracker does not care how it is built — they care what it does
for them. Earlier drafts led with integer arithmetic, derived balances and
`client_mutation_id`, and read as a technical brief.

The rules that produced the current copy:

- **Say what the reader gets, not how it works.** "Your totals match your
  receipts", not "amounts are stored as integer minor units".
- **No jargon on screen.** No *integer*, *paise-as-a-unit*, *ledger*,
  *idempotent*, *derived*, *offline-first*, and no framework names. Those words
  are all still in the code comments, where they belong.
- **Show money as money.** The demos display `₹1,250.50` and
  `₹10,000.00 + ₹92,000.00 − …`, never raw paise counts.
- **Claims must be true.** Every number and feature on the page maps to
  something the app actually does. If a line cannot be checked against the
  code, it does not ship.

## Design

The page uses the app's own design system rather than a separate marketing
look. The colour tokens at the top of the `<style>` block are copied from
`apps/web/src/index.css`:

| Token | Dark | Light | Meaning |
|---|---|---|---|
| `--moneva-bg` | `#0A0B0D` | `#F2F1EC` | the ground |
| `--volt` | `#CDFF4A` | `#6E9600` | money in, positive, the only accent |
| `--ember` | `#FF6B4A` | `#E24F2B` | money out, negative |
| `--amber` | `#E8B62C` | `#A87700` | the one warning colour |

If those change in the app, change them here too — nothing imports them
automatically.

The page opens dark whatever the visitor's system is set to, because pitch is
the ground this identity is built on. The header toggle switches to the light
palette and remembers the choice in `localStorage`.

## What is interactive

The centrepiece is section 02: **a working copy of MONEVA** running in a phone
frame on invented figures. Not a video and not screenshots — the same render
code drives the hero phone and the demo, so they cannot drift apart.

Everything in it is derived from one transaction list, exactly as the real app
derives from the ledger. Add an expense and the net worth, the month's
spending, the budget bars and the activity list all move together.

- All five screens: Home, Activity, Plan, Ask, Profile
- Floating pill nav with the lime FAB; the avatar opens Profile
- The eye icon hides every balance
- Activity filters (All / Expenses / Income / Transfers) and live merchant search
- Plan tabs, budget bars with healthy / tight / over states
- The assistant answers from the data, and *proposes* rather than writes —
  type "petrol 500" and it offers an entry to confirm
- The FAB opens a sheet that records a real transaction
- Profile's Appearance switch re-themes **the phone only**, leaving the page
  alone — the demo carries its own palette

The rest of the page:

- **Paise converter** — type any rupee amount and watch it become the integer
  the database stores. Uses the same digit-matching rule as the app's
  `rupeesToPaise`, never `parseFloat`.
- **Ledger** — switch transactions on and off; the balance recomputes from the
  events, demonstrating that no balance is stored.
- **Alert dedupe** — three notifications for one payment collapsing into a
  single proposal you confirm.
- **Signal trace** — a chart drawn by scroll position, with a dot riding the
  leading edge. Scroll back and it un-draws.
- **Theme toggle**, scroll progress, count-ups, and a pointer-reactive hero.

A note on money formatting inside the demo, which follows the app's own rule:
summaries round (`₹6,248 of ₹16,000`), but anything the app claims to have
recorded is exact (`₹807.50 spent`, `REMAINING: ₹7,192.50`). A finance product
arguing that nothing gets rounded must not round in its own confirmations.

All of it degrades safely: motion is dropped under `prefers-reduced-motion`,
and the page still reads with JavaScript disabled (the demos simply sit at
their initial values).
