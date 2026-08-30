# Design pass — verification record

What was checked, how, and what the instrument actually returned. The contract
these numbers defend is [ARCHITECTURE.md §2.7](ARCHITECTURE.md#27-interface-design-system).

Everything below was measured against a production build (`vite build`,
`VITE_APP_BASE_PATH=/`) served over HTTP and driven through the Chrome DevTools
Protocol, not against a dev server and not by reading the stylesheet.

**No language model, provider or database was involved in any of it.** The
"conversation state" measurements need a transcript on screen, so `/api/chat`
was answered by a local static stub returning a fixed canned reply and two fixed
citations. Nothing here exercises retrieval, generation, embeddings, the
approved corpus or PostgreSQL, and no claim below should be read as evidence
about them. This is a front-end design pass; backend behaviour is unchanged and
untested by this document.

**Numbers versus judgment.** Every table below is a machine reading — pixel
samples, computed styles, animation state, exit codes. Where a decision was a
judgment call rather than a measurement it is written as prose and labelled as
such, notably the two layout-animating transitions kept in §4 and the deferred
cleanup in §6.

---

## 1. Contrast

Measured, not computed from tokens. Two problems make a naive measurement lie,
and both are handled:

- **Antialiasing.** Sampling inside a glyph's own box cannot find the
  background: subpixel rendering paints a continuous ramp from the text colour
  down to the ground, so the brightest "non-glyph" pixel is always a letter's
  edge. Each frame is therefore captured twice — once normally, once with the
  text painted transparent — and the ground is read from the second.
- **Box versus glyphs.** A 430px-wide heading holding twelve characters would
  otherwise be judged against ambient 300px to its right. Ground is sampled
  only within `Range.getClientRects()` — the inline boxes, tight to the text —
  inset by 1px to drop border pixels.

The ambient drifts on co-prime 37–79s periods, so one frame is not the worst
case. Each run is evaluated against the brightest ground seen across **24 phase
samples** spanning the longest period.

### Empty state

| Text run | Colour | Worst ground | Ratio | Needs | Result |
|---|---|---|---|---|---|
| Assistant name (accent) | `rgb(111, 209, 103)` | `rgb(17, 65, 52)` | 6.01 | 4.5 | PASS |
| Scope sentence | `rgb(242, 248, 245)` | `rgb(30, 94, 83)` | 7.02 | 3.0 | PASS |
| Suggested label | `rgb(255, 255, 255)` | `rgb(10, 41, 38)` | 15.46 | 4.5 | PASS |
| Starter question | `rgb(255, 255, 255)` | `rgb(5, 29, 29)` | 17.50 | 4.5 | PASS |
| Composer input | `rgb(242, 248, 245)` | `rgb(24, 52, 52)` | 12.36 | 4.5 | PASS |
| Header title | `rgb(255, 255, 255)` | `rgb(2, 25, 34)` | 18.03 | 4.5 | PASS |
| Header subtitle | `rgb(255, 255, 255)` | `rgb(2, 25, 34)` | 18.03 | 4.5 | PASS |

### Conversation state

| Text run | Colour | Worst ground | Ratio | Needs | Result |
|---|---|---|---|---|---|
| Speaker label | `rgb(157, 179, 173)` | `rgb(11, 37, 40)` | 7.24 | 4.5 | PASS |
| Visitor message | `rgb(242, 248, 245)` | `rgb(11, 37, 40)` | 14.91 | 4.5 | PASS |
| Assistant answer | `rgb(242, 248, 245)` | `rgb(9, 44, 49)` | 13.78 | 4.5 | PASS |
| Source title | `rgb(242, 248, 245)` | `rgb(4, 27, 31)` | 16.52 | 4.5 | PASS |
| Source page | `rgb(157, 179, 173)` | `rgb(4, 29, 34)` | 7.88 | 4.5 | PASS |
| Composer input | `rgb(242, 248, 245)` | `rgb(24, 52, 52)` | 12.36 | 4.5 | PASS |
| Header title | `rgb(255, 255, 255)` | `rgb(2, 25, 34)` | 18.03 | 4.5 | PASS |
| Header subtitle | `rgb(255, 255, 255)` | `rgb(2, 25, 34)` | 18.03 | 4.5 | PASS |

**15 of 15 runs pass. Tightest margin: 6.01:1 against a 4.5:1 requirement.**

The empty-state accent is the tightest because it is the only place a mid-tone
green sits over the ambient at full strength. It holds because the fields are
blurred at 46px: the ambient has no hard bright edge for text to land on.

---

## 2. Responsive and localization sweep

Six viewports × two languages × two surfaces = **24 surfaces**, each checked
for horizontal overflow, elements escaping the viewport, undersized touch
targets that also crowd a neighbour (WCAG 2.5.8 allows a small control with
clear spacing), and clipped text.

| | 320×568 | 390×844 | 430×932 | 768×1024 | 1280×800 | 1440×900 |
|---|---|---|---|---|---|---|
| **en** landing | clean | clean | clean | clean | clean | clean |
| **en** assistant | clean | clean | clean | clean | clean | clean |
| **zh-CN** landing | clean | clean | clean | clean | clean | clean |
| **zh-CN** assistant | clean | clean | clean | clean | clean | clean |

`<html lang>` observed as `en` and `zh-CN` respectively. **Console errors
across the whole sweep: 0.**

### The probe was proved able to fail

"All clean" is only worth something if the instrument can report otherwise, so
four faults were injected into a live page — a 20×20 button crowding a
neighbour, a second one beside it, a 2000px-wide box, and a heading clipped to
8px:

| Injected fault | Detected |
|---|---|
| horizontal overflow | yes |
| element wider than viewport | yes |
| crowded undersized targets | yes |
| clipped text | yes |

---

## 3. Accessibility

### 200% zoom (WCAG 1.4.4)

A 1280×800 window at 200% is a 640×400 CSS viewport. Landing and assistant:
no overflow, nothing escaping the viewport, nothing clipped, no crowded
undersized target.

### Keyboard only

| Check | Result |
|---|---|
| Opens with `Enter` from the landing card | yes |
| Focus moves into the dialog on open | yes |
| Focus stays trapped across 12 consecutive `Tab`s | yes |
| `Escape` closes | yes |
| Focus returns to the exact invoking element | yes |
| Tab stops sampled | 14 |
| Tab stops with no visible focus indicator | **0** |

### Sticky-header clearance

Four in-page `[id]` targets, each carrying `scroll-margin-top: 84px`
(header 68px + spacing). Three land clear of the header.

`#ai-entry-heading` lands 15px from the top, under the 69px header. This is
**not** a scroll-margin defect, and the harness distinguishes the two causes by
experiment rather than arithmetic: raising its `scroll-margin-top` to 400px and
re-navigating leaves the landing position **unchanged at 15px**. The heading
sits 393px into a document whose maximum scroll is 390px — the page ends, and
no margin can move it further. The control case, `#solutions-heading`, lands at
125px, well clear.

It is also unreachable in practice: the product contains **no in-product
fragment links at all**. The `scroll-margin-top` on `[id]` is defensive cover
for a shared deep link.

---

## 4. Motion

| Check | Result |
|---|---|
| `transition: all` anywhere | 0 |
| Literal timings in any `transition` | 0 (3 were tokenised in this pass) |
| Dead `@keyframes` | 0 (4 removed with the orb) |
| Elements holding `will-change` while idle | 6 (the animating layers) |
| Elements holding `will-change` in conversation | **0** |
| Animations paused in conversation | 6 |
| Ambient opacity in conversation | 0.18 |
| Running animations under `prefers-reduced-motion` | **0** |
| Promoted layers under `prefers-reduced-motion` | **0** |
| Ambient still present under reduced motion | yes, `data-state="idle"`, held still |

Two transitions animate a layout property and are kept deliberately:
`.pdf-viewer__progress-bar` animates `width` inside a fixed track with no
siblings, and `.card-link` animates `padding-left` on four rows. Converting
either to a transform would change where the arrow and the row's hairline sit
during the gesture — a visual regression to an approved interaction, in
exchange for layout work that is already negligible at this scale.

The ambient's own 37s/43s/53s/61s/71s/79s periods are literal by design: they
are co-prime so the six layers never resynchronise and the composition never
visibly repeats.

---

## 5. Landing → assistant continuity

The overlay grows from the edge nearest the card that opened it, so the two
read as one object rather than a card and an unrelated sheet. A true
shared-element transition would need measured geometry and would break the
moment the card scrolls out of view; a matched `transform-origin` survives
every layout.

| Viewport | `transform-origin` | Entrance | Exit | Panel removed after exit |
|---|---|---|---|---|
| 1280×800 | `0px 400px` (left centre) | `chatPanelIn`, running, 220ms | `chatPanelOut` | yes |
| 390×844 | `195.2px 0px` (top centre) | `chatPanelIn`, running, 220ms | `chatPanelOut` | yes |

`data-state` moves `open` → `closing` and the panel unmounts only after the
exit animation, so nothing snaps out. Both animations sit above the
reduced-motion guard in `motion.css` and are neutralised by it.

The mark itself is the other half of the continuity: the landing card and the
assistant header render the **same asset** on the same duotone disc, asserted
by test. The former iridescent orbit around it is gone.

---

## 6. Stylesheet hygiene

| Category | `origin/main` `772be7a` | PR baseline `4493370` | Final PR head |
|---|---|---|---|
| Duplicate top-level selectors | 51 | 10 | **0** |
| Dead `@keyframes` | — | 4 | **0** |
| Custom properties introduced by this pass and never read | — | 4 | **0** |
| Literal arrow glyphs in visitor-facing JSX | — | — | **0** |
| `transition: all` | — | — | **0** |

### The duplicate-selector audit was wrong twice before it was right

This is worth recording in full, because both failures produced a confident
number that was false, and the second one nearly shipped.

**Attempt one — line-based.** A line-based check cannot tell a real duplicate
from a multi-line selector group:

```css
.chat__ambient-field,
.chat__ambient-loop {
```

The second line also ends in `{` and reads as a rule of its own. That tool
reported six duplicates, **all six false**, while missing every real one.

**Attempt two — character-level, but comment-blind.** The replacement walked
the file character by character and stepped over comments while scanning. That
is not enough. A rule's selector is the text back to the previous `}`, which
normally includes the section comment above it, so

```css
/* ── Hero ── */

.hero__inner { … }
```

hashed as `/* ── Hero ── */ .hero__inner` and did not match a later plain
`.hero__inner`. This version reported **five** duplicates and silently missed
five more. Comments must be blanked out of the captured selector text, not
merely stepped over.

**Attempt three — correct.** Comments are blanked in a string-aware pre-pass
that preserves byte offsets, then a string-aware brace scan collects top-level
selector lists. Blocks nested in an at-rule are excluded as a different cascade
context, and selector parts are order- and whitespace-normalised so `.a, .b`
matches `.b,\n.a`. This found **eleven** real duplicates: ten present at
baseline `4493370`, plus one introduced by the design pass
(`.card-link:active`).

All eleven are now consolidated. The final count is **zero**, and the parser
plus eleven fixtures live in `frontend/src/tests/DesignSystem.test.tsx` so the
count cannot drift back — including fixtures for each of the two failure modes
above, so neither broken algorithm can be reintroduced without a red test.

### How the ten were consolidated

Every merge landed in the **later** rule, because in every case the later rule
is what already wins. Two of them make the reason concrete:

- **`.site-header__logo`.** Two `@media` height overrides (26px at ≤400px,
  36px at ≥768px) sit between the two rules. Both are dead: `height: 28px` is
  declared after them at equal specificity. Merging *upward* would have revived
  them and changed the rendered height at two breakpoints. Measured at 768px
  after the merge: 28px, not 36px.
- **`.cta__btn`.** The two top-level rules were byte-identical, so neither
  position could change anything — but there are *two* `@media (min-width:
  900px)` blocks naming this selector, one before the consolidated rule and one
  after. The later one is live: `.cta__btn` computes to `0 0 auto` at ≥900px
  and `1 1 240px` below it, before and after.

`:root` is excluded from the count and from the test. It is opened once per
concern — palette, green ramp, focus, targets, layering — each block with its
own rationale, which is a documented convention rather than an accidental
redefinition.

### Behaviour preservation

The corrected build was compared against committed `f050a2e` by reading
computed styles and geometry from both, under emulated
`prefers-reduced-motion` so nothing was captured mid-animation.

**10 surfaces** — 320×568, 390×844, 768×1024, 1280×800, 1440×900, each in
English and Simplified Chinese — covering both header logos, hero geometry,
landing-section spacing, CTA geometry, the language-switch hover state on both
hover-capable viewports, CASPEL AI entry spacing, the suggestions label and
suggestion row, all four product-card row heights, horizontal overflow and the
console.

**Computed-style differences: 0. Console errors: 0 before, 0 after.**

Spot values on the corrected build (English, 1280×800):

| Element | Value |
|---|---|
| `.site-header__logo` | `display: block`, `width: auto`, height 28px |
| `.site-header__ciftis-logo` | `display: block`, `width: auto`, height 32px, `object-fit: contain`, `margin-left: 3px` |
| `.hero__inner` | `max-width: 1180px` (`--layout-max`) |
| `.landing__section` | `margin-bottom: 56px` |
| `.cta__text` | `max-width: 540px` (54ch) |
| `.cta__btn` | `flex: 0 0 auto` at ≥900px, `1 1 240px` below |
| `.lang-switch__option:hover` | `color: rgb(14, 34, 48)`, `background: rgba(0, 0, 0, 0)` |
| `.ai-entry` | `margin: 0px 0px 0px 0px` |
| `.ai-entry__suggestions-label` | `font-size: 12px`, `color: rgba(255, 255, 255, 0.48)` |
| `.ai-entry__suggestion-row` | `display: flex`, `flex-wrap: wrap`, `gap: 16px` |
| `.card-link` × 4 | 82px each |
| horizontal overflow | 0 |

**Two findings are recorded and deliberately not acted on**, because they
pre-date this work and removing them is a cleanup rather than a cascade fix.
Neither has been removed:

- `--shadow-xs`, `--color-dark-surface`, `--color-dark-text-muted` are declared
  and never read.
- Roughly two dozen class families are styled but never rendered — `ai-banner*`,
  `state-notice*`, `chat__chip(s)`, `u-card*`, `btn--accent`, `btn--onDark`.
  (The orphan list also contains false positives: `action-arrow--sm`,
  `action-arrow--md` and `chat__row--user` are built from template strings.)

A third observation, also left alone: consolidating exposed several `@media`
rules that have never applied, because a later top-level declaration at equal
specificity supersedes them — the two logo heights above, and one of the two
`.cta__btn` blocks. Deleting them would be behaviour-neutral but is outside
this correction.

### Two regressions this pass introduced and then removed

Recorded because they are the kind that ships silently:

1. **`min-height: var(--target-min)` on `.card-link`.** Added to guarantee a
   44px target, it *overrode* the existing `min-height: 82px` and shrank all
   four solution rows. The same block also restated minimums that
   `.lang-switch__option` and `.ai-entry__suggestion` already declared.
   Removed; rows re-measured at **82px**, language options at 44px, AI
   suggestions at 44px.
2. **A dead `.modal--chat .chat__source` rule.** The new flex layout was
   written *before* an existing `display: grid` rule for the same selector, so
   every declaration in it lost. Consolidated into one rule at the later
   position, keeping the grid — two tracks are correct for "title truncates,
   page number does not" — plus the baseline alignment the new design needs.

---

## 7. Build and test

| Check | Result |
|---|---|
| `npm ci` from the committed lockfile | pass; lockfile unchanged by the install |
| `tsc --noEmit -p tsconfig.json` | pass |
| `tsc --noEmit -p tsconfig.node.json` | pass |
| Vitest | **173 passed / 173**, 11 files |
| Mode A build (`VITE_APP_BASE_PATH=/`) | pass — assets at `/assets/…` |
| Mode B build (`VITE_APP_BASE_PATH=/ciftis/`) | pass — assets at `/ciftis/assets/…` |
| `git diff --check` | clean |
| Duplicate top-level selectors | **0** |
| Dead `@keyframes` | **0** |
| `caspel-icon.svg` SHA256 | `72702e76…17353750`, unchanged |

New tests added by this pass:

- The ambient contract: present in both states, `data-state` flips
  `idle` → `receded`, six layers throughout. The previous assertion —
  that the layer is *absent* once a conversation starts — was the defect
  written down as a test, and is deliberately not restored.
- Arrow direction read from path geometry rather than a class name, for an
  in-product action, a product route, and every footer destination; `mailto:`
  asserted external **and** not `target="_blank"`.
- No literal arrow glyph in any visitor-facing source file.
- Landing card and assistant header share one mark asset; no orbit decoration.
- Overlay opens from the keyboard, locks the page, and restores focus to the
  exact invoker.
- **The stylesheet cascade audit**: no top-level selector is defined twice in
  any of the seven application stylesheets, plus eleven parser fixtures. The
  fixtures pin both algorithms that previously got this wrong — a multi-line
  selector group must not read as its own rule, and a section comment must be
  stripped from the selector it precedes — along with braces and `/*` inside
  strings, escaped quotes, at-rule contexts staying distinct, resuming
  correctly after a nested at-rule block, selector-part order, and the `:root`
  exemption. A separate fixture proves a genuine non-`:root` duplicate is still
  reported, so the exemption cannot swallow real findings.

The audit was checked against a deliberately reintroduced duplicate before
being trusted: adding a second `.hero__inner` rule to `components.css` turned
two tests red and named the offending selector.

---

## 8. Premium Motion & View Transitions Pass Verification (2026-08-30)

Measured and verified on branch `feat/complete-premium-motion-pass`.

### View Transition Integration & Fallback
- **Progressive Enhancement Engine**: Integrated `transitionNavigate()` wrapping `document.startViewTransition()` and React `flushSync`.
- **Shared-Element Continuity**: Product names and descriptors carry stable `view-transition-name` attributes (`product-title-${slug}` and `product-desc-${slug}`) morphing smoothly between landing rows and product headers.
- **Fallback Verification**: Unsupported environments and `prefers-reduced-motion: reduce` navigate instantly without View Transition invocation.
- **Idempotency & Resilience**: Setup exceptions and callback errors execute fallback navigation cleanly with zero lost navigations or duplicate calls.

### Automated Test Matrix
| Check | Result |
|---|---|
| `npm test` (Vitest) | **183 passed / 183**, 12 files |
| `npm run typecheck` | pass (`tsc --noEmit`) |
| `TransitionNavigate.test.tsx` coverage | 100% pass (7 architecture tests + 3 modified link semantics tests) |
| Mode A production build (`VITE_APP_BASE_PATH=/`) | pass (`vite build`) |
| Mode B production build (`VITE_APP_BASE_PATH=/ciftis/`) | pass (`vite build`) |
| Duplicate top-level CSS selectors | **0** |
| Dead keyframes / literal timing violations | **0** |

### Verified Viewport & Localization Matrix
Verified across 6 key viewports (320×568, 390×844, 430×932, 768×1024, 1280×800, 1440×900) in English and Simplified Chinese (`zh-CN`):
- **390×844 Density**: Header, kicker, CASPEL AI entry button, and all 4 solution rows remain visible within the first viewport.
- **CJK Typography**: Simplified Chinese text wraps without clipping or Latin word-break artifacts.
- **200% Zoom & Focus**: Focus traps, Escape key behavior, and `:focus-visible` ring outlines remain fully functional.
- **Kiosk (`/display`)**: QR code enters via a 220ms `qrIn` curve and settles completely motionless; zero inherited animation or transform loops.
- **Landing Return**: Cold initial load renders `.u-enter` staggered entrance; subsequent internal returns from product pages render settled immediately without re-animating.

