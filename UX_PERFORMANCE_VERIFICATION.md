# Final UX and performance pass — verification record

Completes the three team-lead items that were outside PR #3: the responsive
spacing and sizing audit, the presentation download control, and frontend
performance.

Every number here is a machine reading from a production build (`vite build`)
served over HTTP and driven through the Chrome DevTools Protocol, with the
real API proxied from the running stack so the viewer, manifest and
presentation streams behave as they do in production.

**No language model, ingestion or database write was involved.** Retrieval,
generation, embeddings and the corpus are untouched by this pass.

---

## 1. Responsive audit

**8 viewports × 2 languages × 3 surfaces = 48 surfaces.** Each checked for
horizontal overflow, elements escaping the viewport, undersized targets that
also crowd a neighbour, clipped text, and controls left underneath a sticky
element.

| | 320×568 | 360×800 | 390×844 | 430×932 | 768×1024 | 1024×768 | 1280×800 | 1440×900 |
|---|---|---|---|---|---|---|---|---|
| **en** landing | clean | clean | clean | clean | clean | clean | clean | clean |
| **en** assistant | clean | clean | clean | clean | clean | clean | clean | clean |
| **en** viewer | clean | clean | clean | clean | clean | clean | clean | clean |
| **zh-CN** landing | clean | clean | clean | clean | clean | clean | clean | clean |
| **zh-CN** assistant | clean | clean | clean | clean | clean | clean | clean | clean |
| **zh-CN** viewer | clean | clean | clean | clean | clean | clean | clean | clean |

**Console errors across the whole matrix: 0.**

### The probe was wrong before its result meant anything

The first run reported `under-sticky: modal__close` on all 16 assistant
surfaces. That was false. The probe compared rectangles, and the sticky page
header intersects the assistant's close button while sitting *behind* the
overlay — geometric overlap is not obstruction. It now calls
`document.elementFromPoint` and asks what actually paints at that point.
After the correction: zero obstructed controls.

A second false result came from the static server: the viewer reported the
download control as absent on every viewport, because `/api` was stubbed and
the manifest never said the presentation was available. The audit now proxies
`/api` to the running stack.

### Landing geometry (en, 390×844)

| Surface | Value |
|---|---|
| header | 390×97, `block-size: 96.8px` |
| hero | 390×188, padding 28px / 18px |
| AI entry | 358×88 |
| product row | 358×82, `min-height: 82px` |
| solutions section | 358×407, `padding-top: 40px`, `margin-bottom: 56px` |
| footer | 390×256, padding 32px / 32px |

### Accessibility

| Check | Result |
|---|---|
| 200% zoom, landing and assistant | no overflow, nothing clipped, no crowded target |
| Opens with `Enter` | yes |
| Focus enters the dialog | yes |
| Focus trap holds across 12 `Tab`s | yes |
| `Escape` closes, focus restored to the invoker | yes |
| Tab stops without a visible focus ring | **0 of 14 sampled** |
| Running animations under `prefers-reduced-motion` | **0** |
| Promoted layers under `prefers-reduced-motion` | **0** |

---

## 2. Presentation download control

Measured on the merged build, the control was **122×44px with a 14px label** —
a secondary-looking button for the thing a visitor at the stand most wants.

### After

| Viewport | English | Chinese |
|---|---|---|
| 320–430px | 129×50 | 89×50 |
| 768px and up | 145×50 | 105×50 |

`min-block-size: 50px` (inside the 48–52px band, and clearing the 44px
interactive minimum by construction), 15px label, 18px icon, inline padding
16px on phones and 24px from tablet up, `white-space: nowrap` so neither label
can wrap inside a 50px control. On narrow screens it grows to share the sticky
bar, capped at 320px so it never becomes a full-width banner, and it stays in
the toolbar so it never covers the slides.

### States

`idle` → `starting` → `started` → back to `idle`, plus `failed`. There is no
artificial delay: `starting` is the moment the anchor is created and clicked,
`started` is a short confirmation that the browser took over, and `failed`
fires only if the anchor could not be dispatched. The control does not pretend
to track a transfer the browser owns after that point. All three glyphs share
one grid cell so the swap cannot resize the control under a finger, and the
outcome is announced through a live region.

### Endpoint verification, against the running stack

| | Corporate | ERP |
|---|---|---|
| status | 200 | 200 |
| `Content-Type` | `application/pdf` | `application/pdf` |
| filename | `CASPEL_Corporate_Presentation.pdf` | `CASPEL_ERP_Presentation.pdf` |
| bytes | 24,433,969 | 5,480,032 |
| SHA256 | `051796d6…1811f03` | `e7033d04…f50aab7` |
| range request | 206, `bytes 0-1023/24433969` | 206, `bytes 0-1023/5480032` |

Both hashes match the protected originals exactly.

---

## 3. Performance

### What the landing page was downloading

`chat__composer` was in the main `index` chunk, so every visitor downloaded
the chat transcript, the voice recorder, the citation cards and the
slide-preview loader before deciding whether to open the assistant. Most never
do.

### Initial path, exact bytes from the emitted build

| | Baseline (`f5f3455`) | Final | Delta |
|---|---|---|---|
| initial JS | 274,532 | **256,771** | **−17,761 (−6.5%)** |
| initial CSS | 68,848 | 70,055 | +1,207 (+1.8%) |

Gzipped, the initial path goes from 90.29 kB to 85.32 kB.

The assistant is now an **18.70 kB chunk (6.22 kB gzipped)** that `index.html`
does not reference. The CSS grew because the new download control and the
citation cards from PR #3 carry real rules; it is inside budget.

> A note on method: the first figures recorded for this were derived from
> vite's rounded kB display and were about 4 kB out — larger than some real
> regressions this check exists to catch. Every number above is
> `statSync().size` on the emitted files.

### Already out of the initial path, and asserted to stay out

PDF.js (365.12 kB), the PDF worker (1,325.09 kB), the display route, the QR
code, and the 29 MiB exhibition video. A test reads `index.html` and fails if
any of them is referenced.

### Prefetch

The assistant chunk is warmed on first intent — pointer over the AI card,
keyboard focus, or a finger down on it. Guarded by a ref so it fires once and
never re-renders the page. It is a hint: opening works identically if it never
fires, and nothing is prefetched on mere page load, because most visitors
never open the assistant.

### Bundle budget

A deterministic check reads the emitted build rather than timing anything, so
it gives the same answer on every machine and in CI — byte counts do not move
with a runner's mood. It guards the initial path only; moving code into a lazy
chunk is the point, so lazy chunks are unbudgeted.

Its React-duplication check had to be corrected before it was usable: matching
`__SECRET_INTERNALS` flagged any chunk that merely *consumes* React and
reported a duplication that did not exist. `Minified React error` appears only
in React's own implementation.

### Lab versus field

Everything above is a **lab measurement or a static byte count**. No
field Core Web Vitals data was collected, and none is claimed. Bundle size is
a deterministic proxy for load cost; it is not LCP, and real-user INP cannot
be obtained from a local run.

---

## 4. CSS hygiene

| Check | Result |
|---|---|
| Duplicate top-level selectors | **0** |
| Dead `@keyframes` | **0** (removed `pulseAura`) |
| Literal timings in transitions | **0** (tokenised `transform 0.6s ease`) |
| `transition: all` | **0** |
| Permanent `will-change` | **0** — scoped to the idle ambient state only |

`.viewer-bar__download` had been styled in two files — `min-height` in
`components.css`, padding and font-size in `pages.css`. `pages.css` owns the
viewer bar, so it now owns the whole control.

Two duration tokens were added for motion that had no home: `--dur-route`
(320ms) and `--dur-sheen` (600ms).

### One mistake worth recording

Removing `pulseAura` initially left an orphaned `}` in `motion.css`, because
the removal assumed a two-brace keyframe and that one had more steps. The
build failed with a PostCSS parse error. Caught before commit; braces are now
verified balanced.

---

## 5. Tests and builds

| Check | Result |
|---|---|
| Frontend tests | **247** (from 225) |
| Backend tests | **259**, unchanged |
| `tsc` app + node projects | clean |
| Mode A build | pass |
| Mode B build | pass |
| Protected asset hashes | all 5 unchanged |
| Database | 2 documents / 65 chunks / 65 embedded, unchanged |

New frontend tests cover the download control's semantics, both locales, the
sizing contract read from the stylesheet, and every state; and the bundle
budget, initial-path exclusions and chunk-duplication checks.

---

## 6. Production gates still outstanding

These are **not** completed by this pass and must not be reported as such:

- **Simplified Chinese needs fluent human review.** Automated key parity
  (125/125) proves no key is missing; it says nothing about translation
  quality.
- **Real screen-reader testing** with VoiceOver, NVDA and TalkBack has not
  been performed. The keyboard, focus and live-region results above are
  programmatic checks, not assistive-technology testing.
- **Public deployment is a separate authorization.** Merging source is not
  deploying it.
- `cloudflared.exe` (54 MB) and `clues.md` remain in Git history from
  `a7c9054`. They are untracked and gitignored now, but removing the blob
  needs a coordinated history rewrite.
