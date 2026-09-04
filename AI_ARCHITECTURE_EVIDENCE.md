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
| Viewer LCP measures time to PDF metadata | **Wrong** | LCP is the viewer bar at ~2.8 s; metadata arrives at ~24 s. LCP was gated on route-chunk discovery, which was fixable — so this reported an unfixable cause for a fixable problem (§7). |
| Streaming is a delivered visitor feature | **Was not** | It was implemented and off by default, and the client discovered that by spending a failed request per question. Now server-advertised, with the enabling contract documented (§10). |
| The non-streaming path renders citations cleanly | **Wrong** | Grouped markers left "[, ]" in visitor-facing text on the default path, three times in one answer (§10). |
| A fast first slide is impossible without changing the PDF | **Wrong** | It is impossible *from the PDF*. A 45-62 KB WebP of the same approved page lands in ~2.3 s throttled and 0.4 s unthrottled (§14). |
| Lighthouse LCP is usable on the viewer routes | **Wrong** | Its unthrottled trace observes one 24,434,337-byte deck response and models it at 1638 kbps, putting LCP and TTI at ~119 s. Real browser-reported LCP is used instead (§14). |
| The viewer downloads the whole PDF before metadata | **Wrong** | pdf.js already uses ranges: 16 of 17 requests are 206, and 2.0 MB of 5.5 MB is transferred before first paint. Metadata lands at 3.7–5.4 s (§12). |
| First-page time is dominated by file size | **Wrong** | It was dominated by neighbouring pages competing for bandwidth. Fixing that took Corporate from 40.1 s to 18.2 s with no change to the file (§12). |
| The five protected assets include a "logo" at fa66a874… | **Misidentified** | The approved artifact is `caspel-icon.svg` (`72702e76…`, unchanged). `fa66a874…` is `caspel-logo-horizontal.svg`. A reporting error, not an asset change (§13). |

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

This section covers the protocol and its measured latency. **§10 is the
deployment contract** — what each flag value does, how the browser learns which
paths exist, and what operations must set for visitors to receive streaming.

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

### Results — final, after the route-chunk preload

Three runs per route, medians, against the project's own nginx image.

| Route | LCP | CLS | TBT | FCP | SI | Perf |
|---|---|---|---|---|---|---|
| `/` landing | **1.98 s** ✅ | **0.000** ✅ | **3 ms** ✅ | 1.65 s | 1.65 s | 99 |
| `/display` | **2.11 s** ✅ | **0.000** ✅ | **0 ms** ✅ | 1.58 s | 1.80 s | 98 |
| `/product/caspel` | 2.79 s ❌ | **0.015** ✅ | **89 ms** ✅ | 1.94 s | 3.09 s | 93 |
| `/product/erp` | 2.72 s ❌ | **0.015** ✅ | **141 ms** ✅ | 1.91 s | 2.13 s | 93 |

Targets: LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms.

**Two of four routes meet all three targets. The two PDF viewer routes miss LCP
by roughly a quarter of a second.** No threshold was moved and no run was
discarded to make that read better.

TBT is a laboratory metric. It is not INP, which is field-only, and it is not
reported as INP anywhere.

### Before and after, per route

| Route | LCP | CLS | TBT | SI | Perf |
|---|---|---|---|---|---|
| landing | 2.13 → **1.98** | 0.000 → 0.000 | 42 → **3** | 1.76 → **1.65** | 98 → **99** |
| display | 2.19 → **2.11** | 0.000 → 0.000 | 82 → **0** | 2.88 → **1.80** | 97 → **98** |
| corporate | 2.92 → **2.79** | 0.015 → 0.015 | 98 → **89** | 3.60 → **3.09** | 92 → **93** |
| erp | 2.91 → **2.72** | 0.015 → 0.015 | 180 → **141** | 2.34 → **2.13** | 92 → **93** |

FCP moves out ~0.17 s on the viewers, because the preloaded chunks compete for
bandwidth in the first second. That is the trade that buys the LCP and the TBT,
and it is stated rather than hidden.

### Root cause — correcting what I reported last pass

**I previously wrote that viewer LCP measured "time to document metadata". That
was wrong and is withdrawn.** Tracing the route with real marks rather than
inferring from the audit rules:

| Mark | ERP viewer, before | after |
|---|---|---|
| First paint | 2,019 ms | 1,293 ms |
| Viewer module on screen | 3,078 ms | 1,749 ms |
| **LCP (observer)** | **3,072 ms** | **1,756 ms** |
| PDF metadata available | 26,708 ms | 24,688 ms |
| Page count rendered | 26,765 ms | 24,730 ms |
| First PDF page painted | 26,899 ms | 24,869 ms |

LCP is the viewer bar at ~2.8 s. PDF metadata arrives at ~24 s. They are more
than twenty seconds apart, so LCP was never measuring the document — it was
gated on **route-chunk discovery**, which is fixable, while the 5.4 MB deck is
not. Reporting the wrong cause meant reporting an unfixable problem where a
fixable one was sitting.

The request sequence showed it plainly. Route chunks sat idle:

```
   0 -  990ms  document
1043 - 1806ms  index + vendor + css + font
1962 - 2724ms  ProductPage, pdf, worker, modal   <- nothing until 1962ms
```

The browser cannot know a route chunk exists until the main bundle has been
fetched, parsed and executed as far as the dynamic import.

### Retained: route-chunk preload

Chunk names are written into the document from the bundle at build time, and an
inline script preloads only the ones matching `location.pathname`. Route chunks
now start at **646 ms instead of 1,962 ms**.

Only the visited route is preloaded. Measured request counts confirm the landing
page pays nothing:

| Route | Requests | Route chunks fetched |
|---|---|---|
| `/` | 12 | **none** |
| `/display` | 10 | DisplayPage, qr |
| `/product/erp` | 17 | ProductPage, pdf |

Transfer size and request count are unchanged — the same bytes arrive earlier.
Five tests hold it, including that `/` matches no route key and that the map
works under the corporate subpath as well as the subdomain.

### Reverted: byte-range PDF loading

The viewer sets `disableAutoFetch: true, disableStream: false`. A single ERP run
had shown TBT 1,090 ms and 5,352 KiB transferred, which looked like the whole
deck arriving before first paint. Switching to `disableStream: true` makes
pdf.js fetch byte ranges instead, and the endpoint already answers `206` with
`Accept-Ranges: bytes`.

It worked — 13 partial responses instead of one body — and it made things worse:

| Route | Metric | `disableStream: false` | `disableStream: true` |
|---|---|---|---|
| corporate | TBT | **51 ms** | 218 ms |
| erp | TBT | **160 ms** | 373 ms |
| erp | Perf | **91** | 85 |

Range requests trade one streamed body for a series of round trips at 150 ms
each, and the parsing cost does not go away.

**Reverted.** The 1,090 ms that motivated it was a single run; the three-run
median for the same configuration is 160 ms. That is exactly the trap the ≥3-run
protocol exists to prevent, and it nearly produced a "performance fix" that made
the product slower.

### The remaining miss

Viewer LCP is 2.79 s and 2.72 s against a 2.5 s target. What remains is document
plus main bundle plus paint; there is no idle serial gap left to remove.

Nothing was done to move LCP onto a different element. Hiding the page-count
label, or floating a large element into the viewport, would move the number
without moving the experience — that is metric gaming, and the miss is more
useful than a manufactured pass.

Time to first PDF page is measured and decomposed in §12. The earlier "~24 s
is the 5.4 MB deck arriving" reading was wrong: only 2.0 MB is transferred
before first paint, and the cost was competing page renders, not the file size. It is reported separately from LCP precisely so
the preload cannot be read as having made the document itself faster. It did
not; it made the application around the document arrive sooner.

### The first measurement was invalid, and saying so matters

The first Lighthouse pass ran against a plain static file server in the
scratchpad. That server does not compress. Lighthouse duly reported *"Est
savings of 241 KiB"* from text compression and produced LCP 3.34 s on the
landing route.

nginx has had `gzip on` the whole time. Those numbers measured the harness, not
the product, and none of them are reported here. Everything above is against the
nginx image that actually serves the site.

This is the same failure as the OCR heuristic, one layer up: a measurement that
looked like a result. The rule that caught both is to check what the instrument
is attached to before believing what it says.

### Caching

| Resource | `Cache-Control` |
|---|---|
| Hashed assets (`/assets/*`) | `public, max-age=31536000, immutable` |
| `index.html` | `no-cache, no-store, must-revalidate` |
| pdf.js worker | `public, max-age=31536000, immutable` |
| PDF and MP4 | `Accept-Ranges: bytes`, `206` verified |

### Bundle

| | Raw | gzip |
|---|---|---|
| `vendor` | 162.1 kB | 52.9 kB |
| `index` | 85.7 kB | 30.7 kB |
| `index.css` | 71.8 kB | 13.6 kB |
| `icons` | 7.1 kB | 1.9 kB |
| **Initial total** | **326.7 kB** | **99.1 kB** |
| `pdf` (route) | 365.1 kB | 107.6 kB |
| `CaspelAIModal` (route) | 22.5 kB | 7.5 kB |
| `qr` (route) | 16.7 kB | 6.3 kB |

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

**Result: 0 failures across 144 cells**, re-run after every change in this pass.

A second matrix covers the states the responsive one cannot reach, because they
only exist while an answer is being written: 6 viewports × 2 languages ×
{normal, reduced motion, 200% zoom} = **36 cells, 0 failures**, with streaming
enabled against the live backend. Each cell checks horizontal overflow during
and after streaming, entrance animation replaying per delta, composer drift,
one visitor row and one assistant row, tap targets under 44 px, clipped Chinese,
raw `SOURCE` markers, citation bracket debris, keyboard focus, failed requests,
console errors, and cumulative layout shift while citations arrive.

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

## 10. Streaming — the production configuration contract

An implemented stream that no deployment turns on is not a delivered feature.
This section is the contract operations needs.

### Truth table

| `AI_STREAMING_ENABLED` | Setting resolves to | `GET /api/chat/capabilities` | `POST /api/chat/stream` | What a visitor gets |
|---|---|---|---|---|
| absent | `False` | `{"streaming": false}` | `404` | Plain answer on `/api/chat` |
| `false`, `0`, `no` | `False` | `{"streaming": false}` | `404` | Plain answer on `/api/chat` |
| `true`, `True`, `1`, `yes` | `True` | `{"streaming": true}` | `200` SSE | Incremental text |
| `maybe`, `""`, any other | **rejected at start-up** | — | — | The container does not start |

The last row is deliberate. A typo silently read as `false` would leave a
deployment believing streaming was on; pydantic rejects the value and the
process fails loudly instead.

`AI_CONTEXT_MODE` behaves the same way: `rag` or `full_context`, anything else
refuses to start.

### To give visitors streaming

```
AI_STREAMING_ENABLED=true      # in the deployment's .env
docker compose up -d backend
```

**No frontend rebuild is required.** The browser asks the server, so the same
built assets serve both configurations. Verified by flipping the flag against a
running stack and re-testing without rebuilding.

### How the client knows — and why it is not a 404 any more

The browser cannot know whether a deployment offers streaming. It used to find
out the expensive way: attempt `POST /api/chat/stream`, read the 404, then ask
again on `/api/chat`. Streaming is off by default, so **on a default-configured
deployment that put a failed request in front of every single visitor
question.**

`GET /api/chat/capabilities` returns one boolean. Measured through nginx:

| | Requests per question | Wasted |
|---|---|---|
| Before | `404 /api/chat/stream` → `200 /api/chat` | **1 per question** |
| After | `200 /api/chat` | **0** |

plus one capability request per page load, cached for the page's lifetime.

It is deliberately *not* folded into `/api/health`, which reports liveness and
nothing else so a public probe cannot inventory the deployment. Whether
streaming exists is already observable from a single request, so publishing it
discloses nothing new; no environment value, model name or architecture mode
appears in the response, and five tests assert that.

The answer is a **hint, not a guarantee**. The flag can change between the probe
and the question under a rolling deploy, so the streaming route still answers
404 when disabled and the client still falls back. This removed a wasted
request, not the safety net.

A failed or absent capability route resolves to `streaming: false`. That
degrades to exactly the behaviour that shipped before streaming existed, which
is the safe direction and keeps the client compatible with an older backend.

### Fallback and billing safety

The two failure kinds are not alike, and are not treated alike.

| Situation | Was the provider called? | Behaviour |
|---|---|---|
| Capability says `false` | No | Straight to `/api/chat`. Invisible. |
| `404` from the stream route | No | Fall back to `/api/chat`. Invisible. |
| Stream body ends with no events | Nothing observed | Fall back. Invisible. |
| `error` event | **Yes** | Honest interrupted state, explicit retry. |
| Stream ends after partial text | **Yes** | Honest interrupted state, explicit retry. |

**Automatic fallback happens only where nothing was generated.** Once the
provider has been called, a silent retry would bill a second generation and
could record the question twice, so the visitor is told and decides.

Partial text is never stored as a finished answer, and `AI_QUESTION` fires
exactly once per question whichever path answers it.

### Verified through the real nginx image

Both deployment modes, both languages, flag on and off. Mode B was run as
production runs it: the application container serves at its own root behind a
vhost that owns the `/ciftis/` prefix.

| Mode | Flag | Result |
|---|---|---|
| A `/` | `true` | Incremental text — en 4 growth steps, zh-CN 5 |
| A `/` | `false` | Plain fallback, **0 wasted requests** |
| B `/ciftis/` | `true` | Incremental text — en 5 growth steps, zh-CN 5 |
| B `/ciftis/` | `false` | Plain fallback, **0 wasted requests** |

Every cell: exactly one visitor message, exactly one assistant row, exactly one
finalized entry, one `AI_QUESTION`, citations and slide thumbnails attached,
copy available, no raw `SOURCE` marker, no punctuation debris, zero console
errors.

Frame arrival timing through nginx confirms it is not buffered — `meta` at +0s,
first delta at +1s, twelve delta frames, then validated `citations`, then
`done`. A buffering proxy would deliver all of them together at the end.

`Transfer-Encoding: chunked`, `Content-Type: text/event-stream`,
`cache-control: no-cache, no-transform`, and no `Content-Encoding` — gzip is off
for this location and on for static assets.

A client that disconnects mid-stream produces no unhandled error in the backend
log.

### Two defects found by asking the running application real questions

Neither was visible from the code, and neither was caught by the unit tests.

**Citation debris on the default path.** A visitor was reading

> …into a single ecosystem and database **[, ]**.

three times in one answer. The prompt asks for one identifier per bracket pair;
the model writes groups — `[SOURCE_1, SOURCE_2, SOURCE_3]`. The non-streaming
path removed each `SOURCE_n` and then tidied only `[ ]`, so the separators
survived. This was the **default** path: every visitor, every answer.

**Then the test written for that fix caught the next layer.** A Chinese answer
separates a list with the ideographic comma, so `[SOURCE_1、SOURCE_2]` left
`[、]`. Full-width separators are now in both the group matcher and the bracket
cleanup.

Both delivery arms are asserted to produce identical text from identical input.
Prose inside a bracket is deliberately left alone: `[SOURCE_1 and SOURCE_2]` is
not a form this system asks for, and deleting words the model wrote to tidy a
bracket is worse than the bracket.

### A provider failure, observed rather than simulated

During this pass Gemini's streaming endpoint intermittently returned no data at
all — zero chunks against a 90-second budget — while the non-streaming endpoint
answered the same question in 3.2s. That produced a genuine end-to-end test of
the interrupted path: the visitor saw *"The answer was interrupted. Please ask
again."* with a Try again control, no partial text was stored, and **no second
generation was billed**.

It also means streaming depends on a provider leg that was not continuously
available from this network during testing. The plain endpoint remained
available throughout, which is the reason it stays the default and the rollback.

---

## 11. Gate status

### PASS

| Gate | Evidence |
|---|---|
| Backend suite, no credentials | **340 passed** with `GEMINI_API_KEY` empty |
| Frontend suite | **300 passed**, 19 files, from a clean `npm ci` |
| TypeScript, both projects | clean |
| Mode A / Mode B production builds | both succeed; base paths and injected preloads correct in each |
| Bundle budget | 13 assertions against the emitted build |
| Docker images | backend, nginx Mode A, nginx Mode B all build |
| `docker compose config` | valid in both modes |
| `nginx -t` | syntax ok in the running container and the Mode B container |
| Streaming enabled → visitor receives incremental text | Modes A and B, English and Simplified Chinese |
| Streaming disabled → plain fallback | **0 wasted requests**, both modes |
| Streaming not buffered by nginx | `meta` +0 s, first delta +1 s, 12 delta frames, then `citations`, then `done` |
| Cancellation through nginx | client abort leaves no unhandled backend error |
| Provider failure after generation starts | honest interrupted state, explicit retry, no second generation |
| Grouped and split citation markers | 26 tests; both delivery arms produce identical text |
| English and CJK punctuation | full-width stops and separators handled in both arms |
| Exactly one transcript entry / one analytics event | asserted in tests and observed in the browser |
| Responsive matrix | 144 cells, 0 failures |
| Streaming UX matrix | 36 cells, 0 failures, incl. reduced motion and 200% zoom |
| Download control | 18 cells, 0 failures; endpoint, filename from `Content-Disposition`, 0 px width change |
| Auto-scroll | follows at the bottom, holds position when scrolled up |
| Motion budget | no `transition: all`, no layout-property transitions, no blur > 24 px, 0 permanent compositor layers outside the open modal |
| CLS | 0.000 on landing and display, 0.015 on both viewers |
| TBT | 3 / 0 / 89 / 141 ms — all under 200 ms |
| PDF and MP4 range requests | `206` with correct `Content-Range` |
| Cache headers | `immutable` on hashed assets, `no-store` on `index.html` |
| Security headers | `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` |
| Deep-link refresh | 200 on every route, both modes |
| Protected assets | five SHA256 hashes byte-identical to `origin/main` |
| Corpus integrity | 2 documents, 65 chunks, Corporate 24 pages, ERP 41 pages, no fabricated product |
| No ingestion, no database mutation | read-only throughout |
| Git hygiene | `.env` untracked; `implementation.md`, `cloudflared.exe` absent from every commit; no build output, caches, profiles or screenshots staged; `git diff --check` clean; secret scan clean |

### FAIL

| Gate | Measured | Target |
|---|---|---|
| `/product/caspel` LCP | **2.73 s** | ≤ 2.5 s |
| `/product/erp` LCP | **2.73 s** | ≤ 2.5 s |
| `/product/caspel` interactive PDF page | **18.4 s** | ≤ 5 s |
| `/product/erp` interactive PDF page | **16.5 s** | ≤ 5 s |

LCP improved across the pass (2.92 → 2.73 and 2.91 → 2.73) and both remain over.
No element was moved or hidden to change which one LCP selects.

**A visitor now sees the deck’s real first slide in about 2.3–2.5 s** (§14),
so the visitor-facing gate is met. What remains over target is the
*interactive* PDF page, which is a different thing and is reported as one.

Time to that interactive page improved across this programme — Corporate
40.1 s → 18.4 s, ERP 19.2 s → 16.5 s — and remains far over five seconds. **The reason is arithmetic,
not implementation:** the first slide's own bytes are 1.5–1.7 MB, a 7.4–8.3 s
transfer floor at 1,638 kbps before any request is made (§12). Every delivery
experiment that could have avoided that was tested and failed. The smallest
next architecture step is identified and sized in §12; it was not built,
because it is an architecture change rather than a tuning pass.

Unthrottled, first slide is 0.94 s and 1.19 s. That is the likely venue
experience and it is **not** used to claim the target is met.

### NOT VERIFIED

These need a person, a device, or an environment this work did not have.

- **Real-user INP.** A field metric. Lab TBT is its only laboratory proxy and is
  labelled as such everywhere it appears.
- **Real-device measurement.** Every number here is Lighthouse's simulated
  mobile throttling on a desktop CPU, not a phone.
- **Fluent Simplified Chinese review.** Key parity proves no key is missing and
  says nothing about translation quality.
- **Assistive-technology testing.** No VoiceOver, NVDA or TalkBack run.
  Keyboard, focus and live-region results are programmatic checks.
- **Exhibition network conditions.** The decks are 5.4 MB and 24 MB; behaviour
  with many concurrent visitors on shared Wi-Fi is untested.
- **Sustained provider streaming availability.** Gemini's streaming endpoint
  returned nothing at all from this network for part of this pass, while the
  non-streaming endpoint kept answering. Streaming works and was verified
  end to end; its provider leg was not continuously available here.
- **Cold-start cache behaviour.** The probe never observed a miss.
- **Cache cost saving.** No published percentage, none observed directly.
- **Public deployment.** Separate authorization; nothing here was deployed.

### Standing

Every functionality, correctness, accessibility, infrastructure and integrity
gate passes. Four performance gates do not, and they are named above.

**The visitor-facing performance gate is met.** The deck’s real first slide is
on screen in about 2.3–2.5 s on the documented throttled profile, and in
0.4 s unthrottled.

**The interactive document is still slow.** Scrolling, zooming and text
selection become available at 16–18 s on that profile, because page one’s own
bytes are 1.5–1.7 MB. That is reported as a miss, not hidden behind the
preview.

**This is not production-approved.** The human gates in NOT VERIFIED —
Simplified Chinese review, assistive-technology testing, and a decision on the
viewer LCP exception — are approvals this work cannot grant itself.

---

## 12. Viewer delivery — time to a usable slide

Toolbar LCP is not the visitor's experience. What matters at the stand is when a
slide is on screen, so that is the acceptance metric here. It is reported
separately from LCP throughout, so no scaffold or preload can be mistaken for
having made the document itself faster.

### Method

Thirteen marks per trial, from the browser's own resource timings plus DOM state
polling. Nothing is read off a screenshot. Each trial launches a **fresh browser
with the cache disabled** — an earlier run shared one browser across trials and
produced a 5.6 s-to-25.6 s spread on a single mark purely from cache warming.
Three trials per configuration; medians and ranges below.

Throttled profile: 150 ms RTT, 1,638 kbps down, CPU ×4, 412×823 @ DPR 1.75.

### Decomposition — ERP, throttled, medians

| Mark | Before | After | |
|---|---|---|---|
| navigation start | 0 | 0 | |
| viewer route requested | 670 | 904 | |
| viewer route evaluated | 2,071 | 2,116 | |
| manifest request start → end | 2,056 → 2,215 | 2,094 → 2,262 | |
| PDF request start | 2,438 | 2,507 | |
| first PDF response byte | 2,449 | 2,518 | |
| pdf.js worker ready | 2,332 | 2,403 | |
| PDF metadata available | 5,416 | 5,641 | |
| page count visible | 5,440 | 5,653 | |
| first page render started | 5,474 | 5,660 | |
| **first page visibly painted** | **19,247** | **16,840** | **−12.5%** |
| viewer controls usable | 2,326 | 2,380 | |
| full document downloaded | 38,505 | 38,716 | |

### Decomposition — Corporate, throttled, medians

| Mark | Before | After | |
|---|---|---|---|
| PDF metadata available | 3,760 | 3,742 | |
| page count visible | 3,792 | 3,771 | |
| first page render started | 3,835 | 3,778 | |
| **first page visibly painted** | **40,146** | **18,190** | **−55%** |
| full document downloaded | 53,581 | 57,042 | |

Ranges were tight throughout (Corporate before 40,091–40,226; after
18,158–18,228), so these are differences, not noise.

### Unthrottled, same build

| | metadata | first page painted | controls usable |
|---|---|---|---|
| Corporate | 680 ms | **941 ms** | 337 ms |
| ERP | 925 ms | **1,190 ms** | 375 ms |

A venue with ordinary Wi-Fi is much closer to this than to the throttled
profile. It is reported for completeness and is **not** used to claim the target
is met — the acceptance basis is the throttled profile.

### Root cause

pdf.js was already using range requests: 16 of 17 deck requests were `206`, and
2.0 MB of the 5.5 MB file was transferred before first paint. So "the whole PDF
downloads before metadata" was never true, and metadata was never the problem —
it lands at 3.7–5.4 s.

The gap was between *render started* (5.5 s) and *painted* (19.2 s). With an
800 px prerender margin on an 823 px viewport, two or three pages qualify to
render the moment the deck opens, and their byte ranges compete with page one's
on a 1.6 Mbps link. The page the visitor is looking at loses to pages they
cannot see.

Neither deck is linearized — the cross-reference table sits at 97.8% through the
ERP file — but that costs a few tail round trips, not twenty seconds.

### Retained: first page first, the rest on idle

Page one renders alone; the others wait for it, then wait for an idle main
thread. Releasing them all at once merely relocated the cost (ERP TBT
141 → 341 ms, score 93 → 86); yielding to input recovers it.

The gate is a delay, not a cancellation: a 30 s timeout releases the deck even
if page one never reports rendered.

### Rejected: qpdf linearization

Derivatives were generated outside Git and verified equivalent — identical page
counts (24 and 41), identical text on **every** page, identical renders on
first/middle/last, identical link and image counts, `fast web view` 0 → 1. The
originals were byte-identical before and after.

Measured, they were worse:

| | original | linearized |
|---|---|---|
| ERP metadata | **5,152 ms** | 18,907 ms |
| ERP first page | **19,166 ms** | 23,833 ms |
| requests | **17** | 39 |
| bytes | **2.08 MB** | 2.95 MB |

Rejected. No duplicate 24 MB and 5 MB blobs are committed, and no `qpdf`
dependency is added to any image.

A second finding came out of this: the backend refuses to serve any PDF whose
SHA256 does not match the approved digest, so a derivative cannot be served at
all without registering a second approved digest. That guard is correct and was
left alone; the experiment ran against a throwaway container.

### Rejected: rangeChunkSize tuning

Monotonically worse than the 64 KiB default at every value tested:

| chunk | metadata | first page | requests | bytes |
|---|---|---|---|---|
| 64 KiB (default) | **5,416** | **19,247** | 17 | **7.56 MB** |
| 128 KiB | 6,336 | 19,377 | 12 | 7.69 MB |
| 256 KiB | 7,398 | 20,003 | 10 | 8.08 MB |
| 512 KiB | 10,041 | 20,371 | 8 | 8.87 MB |
| 1 MiB | 14,898 | 30,303 | 7 | 10.96 MB |

Fewer requests, but each over-fetches; the extra bytes cost more than the round
trips saved.

### Why 5 seconds is not reachable, and what would reach it

Page one is not small:

| | page 1 alone | its images | transfer floor @1.6 Mbps |
|---|---|---|---|
| Corporate | 1,692,970 B | 2 images, 1.64 MB | **8.3 s** |
| ERP | 1,519,317 B | 1 image, 1.48 MB | **7.4 s** |

**The first slide's own bytes exceed the five-second budget before a single
request is made.** No delivery strategy — ranges, chunk sizes, linearization —
can transfer 1.5 MB in under 5 s on a 1.6 Mbps link. That is why the simple
experiments failed, and it is arithmetic rather than an implementation defect.

The smallest next architecture step, reported rather than built, is a
pre-rendered first-page image served alongside the deck. Sizing it from the
approved PDFs:

| width | format | Corporate | ERP | transfer @1.6 Mbps |
|---|---|---|---|---|
| 1080 px | JPEG q82 | 118,682 B | 93,092 B | **0.45–0.58 s** |
| 720 px | JPEG q82 | 57,106 B | 47,854 B | 0.23–0.28 s |

13–16× less than the PDF page, and it would put a real first slide on screen in
about half a second. It is a genuine architecture change — generation,
integrity, caching and an honest hand-off to the interactive viewer — and is out
of scope for this pass. It should not be built as a decorative skeleton: it must
show the actual first page, be generated from the approved PDF, and time to the
real interactive page must continue to be reported separately.

---

## 13. Protected assets — path-specific

An earlier report listed five protected assets and identified one of them only
as "logo". That was not a sufficient identifier and it named the wrong file: the
approved artifact is `caspel-icon.svg`, and the hash reported was
`caspel-logo-horizontal.svg`'s. **A reporting error, not an asset change** — the
table below is path-specific so the ambiguity cannot recur.

| Path | SHA256 | Bytes | Blob | HEAD = origin/main = working tree | Blob first appeared | Changed since |
|---|---|---|---|---|---|---|
| `data/presentations/CASPEL_Corporate_Presentation.pdf` | `051796d6…1f03` | 24,433,969 | `34b68ae8` | yes | `b1e2dca` | 0 commits |
| `data/presentations/CASPEL_ERP_Presentation.pdf` | `e7033d04…aab7` | 5,480,032 | `b2df9fea` | yes | `b1e2dca` | 0 commits |
| `frontend/src/assets/caspel.mp4` | `8ff1b1af…7119` | 29,156,565 | `31a8f4db` | yes | `c7d3a3b` | 0 commits |
| `frontend/src/assets/caspel-icon.svg` | `72702e76…3750` | 1,401 | `47bda0b0` | yes | `8f5231b` | 0 commits |
| `frontend/src/assets/ciftis-logo.png` | `e11e30ce…bad7` | 24,055 | `a3399561` | yes | `347a82c` | 0 commits |

`caspel-icon.svg` is `72702e7640d149d9f4feaa6eb39ae014348a2e9b86bd95de45e16fcc17353750`
— an exact match to the approved value, in the working tree, in `HEAD` and in
`origin/main`.

`fa66a874f1a43e0dd7faa5d5db67ae32546a23be91cba6c03c9012586df235f1` is
`caspel-logo-horizontal.svg`, 16,220 bytes, which exists at two paths
(`frontend/src/assets/` and `frontend/public/`) with identical content.

The two PDF digests also match the values recorded in
`docs/PHASE2_1_VERIFICATION_REPORT.md`.

Every blob is unchanged since it first appeared, and every one of those commits
is authored by the repository owner. "Protected" is verified here against the
approved digest itself, not merely against `origin/main`.

### Local operator files

Untouched. Recorded for completeness only.

| Path | On disk | Tracked | Ignored |
|---|---|---|---|
| `.env` | yes, 925 B | no | `.gitignore:12` |
| `implementation.md` | yes, 12,641 B | no | `.gitignore:38` |
| `cloudflared.exe` | yes, 54,893,480 B | no | `.gitignore:47` |
| `clues.md` | **absent** | no | `.gitignore:48` |

`git status --short --untracked-files=all` is empty because all four are
gitignored — `--untracked-files=all` does not list ignored paths. `git status
--ignored` shows the three that exist. `.gitignore` has no staged or unstaged
change and is identical to `origin/main`; `.git/info/exclude` carries no custom
entries. `cloudflared.exe` is ignored, which an earlier note said it was not —
the entries were added in `b1d2afe`.

Nothing here was restored, removed, staged or re-ignored.

---

## 14. First-slide delivery

The previous pass established that no PDF-delivery tuning could put a slide on
screen quickly, because page one's own bytes exceed the budget. This is the
architecture change that follows from that evidence.

### The result

| | Corporate | ERP |
|---|---|---|
| **Authentic first slide painted** | **2,466 ms** | **2,304 ms** |
| Real LCP (browser-reported) | **2,440 ms** | **2,244 ms** |
| LCP element | `IMG` — the slide | `IMG` — the slide |
| Real CLS | **0.016** | **0.016** |
| Unthrottled first slide | — | **404 ms** |
| Interactive PDF page | 18,413 ms | 16,530 ms |
| Preview bytes | 62,090 | 45,280 |

Three cold-cache trials each, fresh browser per trial, 150 ms RTT / 1,638 kbps /
CPU ×4. **The primary target — an authentic first slide within 2.5 s — is met on
both decks.** Corporate varies across runs (2,130 / 2,466 / 2,923 ms medians on
three separate sets), so it sits close to the line rather than comfortably past
it.

Interactive PDF readiness is reported separately and deliberately: ERP improved
slightly (16,840 → 16,530 ms) and Corporate moved 1.2% the wrong way
(18,190 → 18,413 ms), inside the 10% allowance. **A visible slide is not an
interactive document, and the preview must never be read as having made PDF.js
faster.**

### Existing infrastructure, and why a second pipeline was needed

The citation thumbnails from PR #3 render pages with pdf.js at runtime, from the
same `/stream` endpoint, sharing one document per slug. That is the right design
for citations, and it cannot help here: it needs exactly the bytes that take 7-8
seconds to arrive. It was left untouched.

| | Existing thumbnails | First-slide preview |
|---|---|---|
| Generation | runtime, pdf.js | build-time, committed |
| Source | `/api/presentations/{slug}/stream` | approved PDF, hash-verified |
| Output | canvas | WebP, 1080×608 |
| Cost before first paint | the page's own MBs | 45-62 KB |

### Provenance

`backend/scripts/build_slide_previews.py` renders page one and refuses to run
against a source whose SHA256 does not match the digest in
`app.core.presentations` — the same digest the API refuses to serve without.
Verified by tampering with a copy: the run fails with a hash mismatch, writes no
image for that slug, and exits 1. The input is opened read-only; the approved
PDFs were byte-identical before and after.

| Slug | Source | Source SHA256 | Page | Output SHA256 | Size |
|---|---|---|---|---|---|
| caspel | `CASPEL_Corporate_Presentation.pdf` | `051796d6…1f03` | 1 | `ebe278d0…e9e4` | 62,090 B |
| erp | `CASPEL_ERP_Presentation.pdf` | `e7033d04…aab7` | 1 | `e96ea6ee…cb704` | 45,280 B |

Both 1080×608. `--check` re-renders and compares, and reproduces the committed
bytes exactly. PMS and IRISSEA have no approved deck, so they get no preview;
adding one later needs only their real digest in the registry.

### Format choice

Rendered at 1080 px and compared objectively, then inspected at 1:1 on both
slides — a similarity score does not prove text is readable.

| | Corporate | ERP | similarity |
|---|---|---|---|
| JPEG q80 | 111,677 B | 87,437 B | 99.37 / 99.45% |
| JPEG q86 | 136,165 B | 107,258 B | 99.49 / 99.54% |
| **WebP q80** | **64,356 B** | **47,054 B** | **99.49 / 99.49%** |
| WebP q86 | 80,160 B | 58,060 B | 99.59 / 99.56% |

WebP q80 beats JPEG q86 on fidelity at roughly half the size. Visual inspection
found no loss in small text, logo edges, icon strokes or the dark gradients
where banding shows first. No EXIF, no alpha, exact source aspect ratio.

A browser without WebP support loads no preview and gets exactly the behaviour
that shipped before, so no second format is committed.

### Scheduling — measured, not assumed

| Variant | ERP first slide |
|---|---|
| Preview discovered by the module that imports it | 3,830 ms |
| Declared in the document | 3,325 ms |
| Declared + pdf.js dynamic, no preload for it | 3,948 ms |
| **Declared + pdf.js dynamic + declared in the map** | **2,304 ms** |

Three findings behind that table:

**The image was fetched late because nothing declared it.** It is imported by
the viewer module, so the browser could not discover it until that module had
downloaded, parsed and executed. Declared in the document it starts at ~800 ms
and is downloaded by ~1,500 ms.

**Then the bottleneck moved from network to parsing.** The image was in hand at
1.6 s and could not be displayed until 3.3 s, because the module holding the
`<img>` statically imported 365 KB of pdf.js. Loading pdf.js dynamically fixes
that.

**Doing that alone made it worse.** The route-preload map was built from static
imports, so pdf.js fell out of it and was discovered late — costing more than
the deferred parse saved. The map now follows a route chunk's own dynamic
imports, one level deep. Transitively it reaches the router and therefore every
route, which is the blanket preload the map exists to prevent.

`requestIdleCallback` is used only for deferred pages 2..N and carries a 2 s
timeout, so a busy device cannot postpone the document indefinitely.

### Lighthouse cannot measure these routes

Reported for completeness, not used as evidence:

| Mode | Corporate | ERP |
|---|---|---|
| `simulate` | LCP 122.8 s, score 74 | LCP 30.1 s, score 55 |
| `devtools` | did not complete | LCP 4.48 s, TBT `NaN`, score 0 |

The cause is in the trace. Lighthouse observes unthrottled, where pdf.js takes
the full-stream path and fetches the deck as **one 24,434,337-byte response**,
then models that at 1,638 kbps — about 119 seconds — so LCP and TTI both land
there. Both runs show identical deck bytes, so this is the simulator, not a
change in what the product fetches.

Before this work the simulated LCP read 2.72 s only because the LCP element was
the toolbar's page-count label. It now tracks the actual slide, which is the
honest candidate and the one the brief asked for — and exposes that the
simulator's number was never describing the presentation.

The figures used above are `PerformanceObserver` LCP and CLS from the page
itself under real CDP throttling, which is what the visitor experiences.

### Failure behaviour

| | |
|---|---|
| Preview fails to load | It disappears; the PDF path is untouched |
| PDF fails to load | Error panel with retry, open-in-tab and download |
| Product has no approved deck | No preview at all |
| Page one never paints | 30 s gate timeout releases the rest of the deck |

The download always serves the original approved PDF: 24,433,969 bytes,
`attachment; filename="CASPEL_Corporate_Presentation.pdf"`.
