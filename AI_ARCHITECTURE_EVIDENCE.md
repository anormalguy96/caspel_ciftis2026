# AI architecture and delivery — measured evidence

What was measured, with what instrument, and what it does and does not
establish. Figures are machine readings; where an instrument was wrong it is
recorded as such rather than quietly corrected.

**RAG remains the production default.** Nothing here changes it.

---

## 1. Corrections to earlier claims

Several statements made in an earlier planning pass came from secondary sources
and did not survive contact with primary documentation or measurement.

| Earlier claim | Status | What is actually true |
|---|---|---|
| Corpora under ~200k tokens should skip RAG | **Withdrawn** | An Anthropic heuristic from a Claude and prompt-caching context. Not a rule binding a Gemini application. |
| Full-context ≈ Contextual Retrieval | **Wrong** | Different architectures. Contextual Retrieval still retrieves; it enriches each chunk before embedding. |
| Corpus is ~11,400 tokens | **Wrong, −30%** | `countTokens` reports **17,049** for the serialised corpus. |
| Implicit cache minimum is 1,024 tokens | **Unsupported** | Published minimums are per-model. Gemini 3.5 Flash is 4,096. Flash-Lite is not listed. |
| Explicit cache minimum is 32,768 tokens | **Unsupported** | Not stated on the caching page. |
| Cached tokens are 90% cheaper | **Unsupported** | The page states savings are passed on; no percentage is given. |
| Streaming feels "40–60% faster" | **Withdrawn** | Replaced with measured TTFT from this application. |
| Score clustering shows slide chunking is defective | **Withdrawn** | A slide is also the natural citation boundary, and retrieval scores 100%. No experiment supports changing it. |
| OCR quality is poor on 39 of 65 pages | **Withdrawn** | The heuristic counted Azerbaijani orthography and product abbreviations as corruption. Corrected: 4 pages, one cosmetic artifact, no retrieval impact (§6). |
| Landing LCP is 3.34 s | **Withdrawn** | Measured against an uncompressed scratchpad server. Against the real nginx image it is **2.13 s** (§7). |
| The ERP viewer blocks for 1,090 ms | **Withdrawn** | A single run. The three-run median for the same build is **160 ms** (§7). |
| Byte-range PDF loading would be faster | **Tested and rejected** | It works, and it is slower: corporate TBT 51 → 218 ms, ERP 160 → 373 ms. Reverted (§7). |

---

## 2. Token baseline

`countTokens` against the exact serialised request, model `gemini-3.5-flash-lite`.

| Component | Tokens |
|---|---|
| Corpus only, 65 fenced records | 17,049 |
| System instruction | 608 |
| Citation protocol | 93 |
| Representative history, two turns | 35 |
| Current question | 8 |
| **Full-context request** | **17,817** |
| **RAG request, 6 retrieved chunks** | **2,540** |

**Full context costs 7.0× the input of retrieval for the same question.**

A `chars/3.5` estimate put the corpus at 13,105. The real figure is 30.1%
higher — an error larger than several differences this comparison exists to
detect, which is why the estimate is used nowhere.

---

## 3. Caching — measured, not assumed

The published table lists per-model implicit minimums and does not mention
Flash-Lite. Rather than infer a threshold, the same byte-stable prefix was sent
three times and `usage_metadata` was read.

| Call | Input | `cached_content_token_count` | Prefix byte-stable |
|---|---|---|---|
| 1 | 17,752 | **12,263** | yes |
| 2 | 17,750 | **12,263** | yes |
| 3 | 17,749 | **12,263** | yes |

`gemini-3.5-flash-lite` **does** report cached content — consistently 69% of
input. Established from usage metadata; latency was never used to infer a hit.

**Honest limit:** the first probed call already reported a hit, because earlier
runs in the same session had primed the prefix. A cold miss is *not*
demonstrated. No cost saving is claimed, because no discount figure is
published and none was observed directly.

---

## 4. Architecture comparison

20-case acceptance split, one pass, no retry. Identical system prompt, identical
`<source>` fencing, identical `resolve_citations`.

| Metric | RAG | Full context |
|---|---|---|
| Citation document precision | 100.0 | 100.0 |
| Citation page precision | 100.0 | 100.0 |
| No-context precision | 100.0 | 100.0 |
| Response language correct | 100.0 | 100.0 |
| Median latency (ms) | 7,471 | 1,527 |
| Errors | 0 | 4 |
| Input tokens per request | 2,540 | 17,817 |

Retrieval metrics apply only to the RAG arm: Recall@4 100%, Recall@8 100%,
MRR 0.9688, follow-up 100%.

### What this does and does not establish

**The latency column is not a ranking.** Provider variance during these runs
exceeded the difference being measured: the same question took 1,197 ms and
15,897 ms in different samples, and several calls returned 504. The two arms
recorded their errors in different runs. A single 20-case pass cannot separate
architecture from provider weather.

**On quality the two arms are indistinguishable here** — both 100% on every
correctness metric that produced a result.

**Full context costs 7.0× the input tokens**, of which roughly 69% is currently
returned by the cache.

### A harness fault, not a result

The first run scored full context at **0%** on "no forbidden claim", which reads
as a safety failure. It was not. Exactly one row was flagged:
`acc-neg-pms-price`, with **zero sources and `grounded=false`** — a correct
refusal whose text reads "I do not have pricing information", containing the
forbidden word "price". A substring check cannot distinguish quoting a price
from declining to give one. The check now applies only to answers that assert
something. Classification: **HARNESS ARTIFACT**.

### Conclusion

**Retain RAG and continue the experiment.** Full context matches RAG on quality
in this bounded run but costs 7× the input, and the latency evidence is too
noisy to support a preference either way. Nothing justifies switching the
default, and nothing justifies deleting either path.

---

## 5. Streaming

`POST /api/chat/stream`, behind `AI_STREAMING_ENABLED`, **default false**.

### Measured, three paired runs

| Run | Case | Non-streaming (ms) | Streaming TTFT (ms) | Lower? |
|---|---|---|---|---|
| 1 | corporate | 1,197 | 797 | yes, −33% |
| 1 | erp | 1,341 | 975 | yes, −27% |
| 1 | chinese | 21,805 * | 8,208 | contaminated |
| 2 | corporate | 1,209 | 826 | yes, −32% |
| 2 | erp | 1,631 | FAILED * | ReadTimeout, since fixed |
| 2 | chinese | 1,570 | 759 | yes, −52% |
| 3 | corporate | 15,897 * | 10,015 | contaminated |
| 3 | erp | 1,615 | 8,731 | **no** |
| 3 | chinese | 9,175 * | 953 | contaminated |

`*` = provider retry, 504 or timeout in that sample.

Streaming had lower TTFT in **7 of 8 successful pairs**. On the four pairs
uncontaminated by a provider retry, the reduction was **27% to 52%, median
about one third**.

**Total generation time is not reduced.** Streaming starts showing the answer
sooner; on one sample the streamed total was longer. No claim is made that the
interface "feels" any particular percentage faster — that was not measured.

**Three samples cannot establish magnitude**, only direction. Provider variance
is larger than the effect.

### A bug the measurement found

The streaming call initially reused the 20-second per-request timeout. That
value bounds one opaque call; applied to a stream it bounds the whole delivery
and killed a long answer mid-flight. The ERP question — roughly twice the text
of the others — failed with `ReadTimeout`. It now uses the total deadline.

### Safety properties

Citation markers never reach the visitor. A marker can split across provider
chunks (`[SOU` then `RCE_1]`); the filter withholds at most 16 characters — the
longest prefix that could still become a marker — and releases everything else
immediately.

A failure after the first token is not a 503. Once text is sent the status is
already 200, so a mid-stream failure is an `error` event with a `recoverable`
flag, true only when nothing was shown. `done` and `citations` are never
emitted after a failure, and the transcript is written only on a clean finish.

nginx gets a dedicated location: buffering off, gzip off (its compression window
reintroduces the latency streaming removes), chunked encoding, longer read
window backed by heartbeats.

---

## 6. OCR audit — corrected

Read-only against the indexed corpus. The protected PDFs were not touched, and
nothing was re-extracted or re-ingested.

### The first heuristic was the defect

The earlier pass reported 39 of 65 pages as "stray-glyph heavy" and I recorded
that as a harness artifact. That was the right call but the wrong stopping
point: a measurement that flags 60% of a corpus and predicts nothing should be
replaced, not annotated. Left in place it invites someone to "fix" extraction
that is not broken.

The signal counted isolated one- and two-letter capitals. The ERP deck is
Azerbaijani, so that fires on ordinary text; it also fired on `ERP`, `PMS`,
`CRM`, `LRIT` and `AZN`. It was measuring the corpus's language, not its
quality.

### The replacement

It now looks only for things that cannot be legitimate text: Unicode
replacement characters, control characters, symbol density far above prose, a
long run repeated verbatim, a stranded page number, and text in which no word
survives longer than three characters. Azerbaijani letters, Chinese, product
names and abbreviations are explicitly not suspicious. Pages that are mostly
graphics are reported separately from pages that are broken, because a photo
slide with a two-word caption is intact.

Thirteen tests in `backend/tests/test_ocr_audit.py` hold both halves: real
Azerbaijani, Chinese and product terminology must stay clean, and each genuine
corruption signal must still fire.

### Result

| | First heuristic | Corrected heuristic |
|---|---|---|
| Pages flagged | 39 of 65 | **4 of 65** |
| Evaluation cases touching a flagged page | 44 | **1** |
| False positives on inspection | 39 | **0** |

The four are real, and all four are the same artifact — the slide number bleeding
into the extracted text:

| Page | Extracted head | Letters |
|---|---|---|
| caspel p19 | `19\nProjects \nDisaster Recovery Center` | 1030 |
| caspel p20 | `20\nProjects II/ III\nEstablishment of a Situation Center` | 1368 |
| caspel p21 | `21\nProjects III / III\nObligations Management System` | 454 |
| caspel p23 | `PARTNERS\n23` | 8 |

Each was read by eye rather than trusted from the score.

### Impact: none measured

One evaluation case expects a flagged page. Retrieved directly:

```
query   : Has CASPEL delivered a disaster recovery centre?
expects : caspel p19
retrieved: (caspel, 19, 0.7670)  <- rank 1, highest score
           (caspel,  6, 0.7483)
           (caspel, 20, 0.7474)
           (caspel, 21, 0.7255)
```

The expected page ranks first despite the artifact. A stray `19` contributes
one meaningless token to a 1,030-letter page.

**Extraction was not changed.** Not because the earlier evidence forbade it, but
because the corrected evidence does not support it: the only real defect is
cosmetic, does not affect retrieval, and fixing it would require re-ingesting a
protected corpus to remove a token nothing reads.

ERP p1 is a 45-letter title slide. It is classified as mostly-graphics, which is
a property of the slide, not a defect.

---

## 7. Performance — measured

### Environment

| | |
|---|---|
| Lighthouse | 12.8.2 |
| Browser | HeadlessChrome 131.0.0.0 |
| Host | Windows 11, Docker Desktop |
| Surface | the project's own nginx image, `127.0.0.1:8080` |
| Form factor | mobile, 412×823 @ DPR 1.75 |
| Throttling | simulated; RTT 150 ms, 1,638 kbps, CPU ×4 |
| Cache | cold — Lighthouse uses a fresh profile per run |
| Runs | 3 per route; the table reports **medians** |

### The first measurement was invalid, and saying so matters

The first Lighthouse pass ran against a plain static file server in the
scratchpad. That server does not compress. Lighthouse duly reported *"Est
savings of 241 KiB"* from text compression and produced LCP 3.34 s on the
landing route.

nginx has had `gzip on` the whole time. Those numbers measured the harness, not
the product, and none of them are reported here. Everything below is against
the nginx image that actually serves the site.

This is the same failure as the OCR heuristic, one layer up: a measurement that
looked like a result. The rule that caught both is to check what the instrument
is attached to before believing what it says.

### Results

| Route | LCP | CLS | TBT | FCP | SI | Perf |
|---|---|---|---|---|---|---|
| `/` landing | **2.13 s** ✅ | **0.000** ✅ | **42 ms** ✅ | 1.76 s | 1.76 s | 98 |
| `/display` | **2.19 s** ✅ | **0.000** ✅ | **82 ms** ✅ | 1.82 s | 2.88 s | 97 |
| `/product/caspel` | 2.99 s ❌ | **0.015** ✅ | **51 ms** ✅ | 1.78 s | 3.49 s | 92 |
| `/product/erp` | 3.02 s ❌ | **0.015** ✅ | **160 ms** ✅ | 1.70 s | 2.25 s | 91 |

Targets: LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms.

**Two of four routes meet all three targets. The two PDF viewer routes miss LCP
by roughly half a second.** No threshold was moved and no run was discarded to
make that read better.

TBT is a laboratory metric. It is not INP, which is field-only, and it is not
reported as INP anywhere.

### Why the viewer routes miss LCP

The LCP element on both viewers is `.viewer-bar__meta` — the page-count label —
and 84% of its LCP time is render delay, not network:

```
TTFB          462 ms   16%
Load Delay      0 ms    0%
Load Time       0 ms    0%
Render Delay  2462 ms   84%
```

The label reads "41 pages", so it cannot paint until pdf.js has parsed enough of
the document to know how many pages there are. LCP on these routes is therefore
a measure of time-to-document-metadata. That is real latency a visitor
experiences, not an artifact, and it is reported as a miss.

Choosing a different element to be the LCP candidate would move the number
without moving the experience, so it was not done.

### An optimization that was measured and rejected

The viewer sets `disableAutoFetch: true, disableStream: false`. A single ERP run
had shown TBT 1,090 ms and 5,352 KiB transferred, which looked like the whole
deck arriving before first paint. Switching to `disableStream: true` makes
pdf.js fetch byte ranges instead, and the endpoint already answers `206` with
`Accept-Ranges: bytes`.

It worked — 13 partial responses instead of one full body — and it made things
worse:

| Route | Metric | `disableStream: false` | `disableStream: true` |
|---|---|---|---|
| corporate | TBT | **51 ms** | 218 ms |
| corporate | Perf | **92** | 88 |
| erp | TBT | **160 ms** | 373 ms |
| erp | LCP | 3.02 s | **2.94 s** |
| erp | Perf | **91** | 85 |

Range requests trade one streamed body for a series of round trips at 150 ms
each, and the parsing cost does not go away.

**The change was reverted.** The 1,090 ms that motivated it was a single run;
the three-run median for the same configuration is 160 ms. That is precisely the
trap the ≥3-run protocol exists to prevent, and it nearly produced a
"performance fix" for a problem that did not exist.

### The one real defect found, and fixed

`index.html` preloaded `fonts/Inter-var.woff2`. There is no `public/fonts`
directory. The SPA fallback answered with `index.html`, so the request returned
**200** and looked healthy; the browser discarded 2.7 KiB of HTML as the wrong
type, and the font the stylesheet actually wanted was still discovered only
after the CSS parsed.

Measured on the landing route:

| | Font requests |
|---|---|
| Before | 2 — `/assets/Inter-var-*.woff2` and `/fonts/Inter-var.woff2` (HTML) |
| After | **1** — `/assets/Inter-var-BT1H-PT_.woff2`, `font/woff2` |

The link is now injected from the bundle, so it always names the hashed file the
CSS references, in both deployment modes. Two assertions in `BundleBudget.test.ts`
fail if a preload target is missing from the build or does not match the CSS.

No timing improvement is claimed for this. A paired before/after Lighthouse run
was not performed, so the evidence is the request count and content type.

### Bundle

| | Raw | gzip |
|---|---|---|
| `vendor` | 162.1 kB | 52.9 kB |
| `index` | 85.7 kB | 30.7 kB |
| `index.css` | 71.8 kB | 13.6 kB |
| `icons` | 7.1 kB | 1.9 kB |
| **Initial total** | **326.7 kB** | **99.1 kB** |
| `pdf` (lazy) | 365.1 kB | 107.6 kB |
| `CaspelAIModal` (lazy) | 22.5 kB | 7.5 kB |
| `qr` (lazy) | 16.7 kB | 6.3 kB |

pdf.js, the AI modal, the QR generator and the display page stay out of the
initial path. The budget test asserts this by reading the emitted build, not by
timing anything, so CI and local agree.

---

## 8. Responsive and motion matrix — measured

9 viewports × 2 languages × 8 surfaces = **144 cells**, driven through a real
Chromium at the correct device pixel ratio and touch capability.

Viewports: 320×568, 360×800, 375×812, 390×844, 768×1024, 820×1180, 1280×800,
1440×900, 1920×1080. Languages: `en`, `zh-CN`. Surfaces: landing, landing
scrolled, `/display`, both viewers, viewer scrolled, AI modal empty, AI modal
with a typed question.

Each cell is checked for horizontal overflow, elements bleeding past the
viewport that no scroller explains, interactive targets under 44 px that are
also crowded, text a clipping ancestor actually cuts off, and console errors.

**Result: 0 failures across 144 cells.**

### Two probe faults were found before any product change

Both are worth recording, because in both cases the instrument was wrong and
"fixing" the product would have made it worse.

**Clipped text.** The first probe flagged any element whose `scrollHeight`
exceeded its `clientHeight` while `overflow` was `visible`. That is not
clipping; it is what `line-height: 0.98` looks like. It reported `.hero__title`
on every mobile cell in both languages. An overflowing box only hides text when
something clips it, so the probe now walks up to a clipping ancestor and checks
the actual geometry.

**Screen-reader-only labels.** A `.visually-hidden` element is a 1 px clip box
by design. Once the clipping check was correct it reported all 36 of them.

Neither produced a code change. The remaining check is the one that found the
real download-control defect below.

### Motion audit (post-#4)

Read from the live CSSOM on every surface rather than by grepping stylesheets:

| Forbidden pattern | Occurrences |
|---|---|
| `transition: all` | **0** |
| Transition on an unbounded layout property | **0** |
| Animated blur > 24 px | **0** |
| Permanent compositor layers | **0** on landing, `/display` and both viewers |

The only `will-change` in the project is `transform` on `.chat__ambient-field`
and `.chat__ambient-loop`, six elements, present only while the AI modal is
open and its ambient field is actually animating. Promoting an element that is
continuously animating is what `will-change` is for.

No Framer Motion, Lottie, GSAP, canvas or WebGL was added. Nothing measured
suggested the current stack was the constraint.

---

## 9. Download control — audited, not redesigned

The control was already correct in structure: a primary-sized button, three
icons in a single grid cell so the confirmation swap cannot resize it, a live
region for the announcement, and the verified endpoint owned by the service
rather than built in the component.

One thing it got wrong, and it took measurement to see: the **label** was not
given the same treatment as the icons, and the label is the part that changes
length.

| | Width change across states | Left edge moves |
|---|---|---|
| Before, English | 54.3 px | up to 44 px |
| Before, Chinese | 44.6 px | up to 44 px |
| **After, both** | **0.0 px** | **0 px** |

The button grew under the finger that had just pressed it, at every mobile
viewport, in both languages — while the component's own comment asserted the
swap "cannot resize the control". Every label state now shares one grid cell, so
the control is as wide as its longest label. Reserving by layout rather than by
a pixel constant means a retranslated label stays correct.

### Verified per cell — 9 viewports × 2 languages, 0 failures

| Property | Result |
|---|---|
| Resting size | 183.8 × 50 px (≥ 44 px in both axes) |
| Reachable without scrolling | yes, every viewport |
| Focusable, and keeps focus when pressed | yes |
| Width change when pressed | 0 px |
| Label wrapping | none |
| Endpoint actually requested | `/api/presentations/caspel/download` |
| Filename Chrome derived from `Content-Disposition` | `CASPEL_Corporate_Presentation.pdf` |
| Announcement (en / zh-CN) | "Download started" / "已开始下载" |

The filename is read from what Chrome derived, which verifies the header rather
than trusting it: the endpoint returns `content-disposition: attachment;
filename="CASPEL_Corporate_Presentation.pdf"`, `application/pdf`, 24,433,969
bytes.

A harness note, since it produced 18 false failures first: a download runs on
the browser process, so neither Puppeteer's `response` event nor the page's
`Network` domain ever observes it. `Browser.downloadWillBegin` does.

---

## 10. Configuration

| Setting | Default | Meaning |
|---|---|---|
| `AI_CONTEXT_MODE` | `rag` | `rag` or `full_context`. Server-owned; the browser cannot select it. An unrecognised value fails production validation rather than falling back silently. |
| `AI_STREAMING_ENABLED` | `false` | Enables `POST /api/chat/stream`. Off until verified behind a deployment's own proxy. |
| `AI_STREAM_HEARTBEAT_CHUNKS` | `24` | Heartbeat cadence in provider chunks; `0` disables. |

---

## 11. Outstanding gates

Not established by this work and not to be reported as complete:

- **LCP on the two PDF viewer routes.** Measured at 2.99 s and 3.02 s against a
  2.5 s target. The cause is identified (§7) and the miss is not worked around.
- **Real-user INP.** A field metric. Lab TBT is its only laboratory proxy and is
  labelled as such wherever it appears.
- **Real-device measurement.** Every number here is Lighthouse's simulated
  mobile throttling on a desktop CPU, not a phone.
- **Fluent Simplified Chinese review.** Key parity proves no key is missing and
  says nothing about translation quality.
- **Assistive-technology testing.** No VoiceOver, NVDA or TalkBack run has been
  performed; keyboard, focus and live-region results are programmatic checks.
- **Real network conditions for the viewers.** The decks are 5.4 MB and 24 MB;
  behaviour on exhibition Wi-Fi with many concurrent visitors is untested.
- **Cold-start cache behaviour.** The probe never observed a miss.
- **Cache cost saving.** No published percentage, none observed directly.
- **Streaming under a production proxy.** Verified against the container nginx
  configuration only, with `AI_STREAMING_ENABLED` still `false` by default.
- **Public deployment.** Separate authorization; nothing here was deployed.
