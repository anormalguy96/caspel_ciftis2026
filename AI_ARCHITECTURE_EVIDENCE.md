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

## 7. Configuration

| Setting | Default | Meaning |
|---|---|---|
| `AI_CONTEXT_MODE` | `rag` | `rag` or `full_context`. Server-owned; the browser cannot select it. An unrecognised value fails production validation rather than falling back silently. |
| `AI_STREAMING_ENABLED` | `false` | Enables `POST /api/chat/stream`. Off until verified behind a deployment's own proxy. |
| `AI_STREAM_HEARTBEAT_CHUNKS` | `24` | Heartbeat cadence in provider chunks; `0` disables. |

---

## 8. Outstanding gates

Not established by this work and not to be reported as complete:

- **Real-user INP.** A field metric. Lab TBT is its only laboratory proxy and is
  labelled as such wherever it appears.
- **Fluent Simplified Chinese review.** Key parity proves no key is missing and
  says nothing about translation quality.
- **Assistive-technology testing.** No VoiceOver, NVDA or TalkBack run has been
  performed; keyboard and live-region results are programmatic checks.
- **Cold-start cache behaviour.** The probe never observed a miss.
- **Cache cost saving.** No published percentage, none observed directly.
- **Streaming under a production proxy.** Verified against the container nginx
  configuration only.
- **Public deployment.** Separate authorization; nothing here was deployed.
