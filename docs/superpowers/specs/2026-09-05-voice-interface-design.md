# A voice interface for charliecheesman.net

Design, 5 September 2026.

A visitor can ask the site questions out loud — about the site, and about Charlie —
and hear it answer. It lives at `/ask/`, it is built on an ElevenLabs agent, and it
loads nothing until someone clicks.

## Why this needs a design at all

`CLAUDE.md` states the site's governing constraint: nothing blocks the first paint,
two blocking requests per page, no framework, no client-side rendering. That rule has
been qualified exactly once, for Google Analytics, and the note recording that
qualification ends with a warning — *don't let a third thing in on the strength of the
precedent.*

This is a third thing, and a much larger one than a tag. So the constraint is not
waived here; it is restated in a form this feature can satisfy:

> **Nothing loads until the visitor asks for it.**

The idle cost of `/ask/` is around 990 bytes of inline JavaScript: a button and a lazy
loader, plus the AudioContext setup and in-flight guard later builds added to keep the
click gesture intact on iOS. The client, the microphone, the WebSocket and every byte
of audio are fetched inside the click handler. For any visitor who never clicks — which
is most of them, and every crawler — the page is still the HTML and the stylesheet,
exactly as before: the stub adds bytes to that one request, not a second one. No other
page on the site changes at all.

This is a better rule than the one it replaces. "Two requests" was always a proxy for
what actually mattered; "nothing before an interaction" is the thing itself, and it
survives the next question better.

## Decisions taken

Three questions branched the design. All three are settled.

**It lives at `/ask/`, as a page.** Every other section here is a page with a nav
entry and a description. A floating bottom-right bubble is precisely the furniture
this site is defined by not having. A real URL means it is indexable, it appears in
the sitemap, it gets a description written for a human, and it has somewhere sensible
to degrade to when JavaScript is off.

**A neutral voice, speaking about Charlie rather than as him.** "Charlie spent five
years at EY-Parthenon", not "I spent five years at EY-Parthenon". The agent is a guide
to the site, not an impersonation of its owner. This is the decision that lets it
honestly say *that isn't on the site* — a first-person agent has to either answer or
visibly fail, and both are claims attributed to Charlie that the site then has to
stand behind. A cloned voice was considered and rejected for the same reason,
amplified: one bad answer in his own voice sounds like he said it.

**The dependency question is settled by measurement, not by taste.** See below.

## Architecture

```
Browser (/ask/)                     ElevenLabs                    Charlie's machine
─────────────                       ──────────                    ─────────────────
inline stub  ──click──▶ voice.js
                          │
                          └─ wss://api.elevenlabs.io/v1/convai/conversation
                             ?agent_id=<public agent>   ◀── agent config
                                                            + knowledge base
                                                                  ▲
                                                                  │
                                                        npm run agent:sync
                                                        (manual, needs API key)
                                                                  ▲
                                                                llms.txt
                                                                  ▲
                                                            npm run build
```

There is no server. A **public** ElevenLabs agent — one with authentication disabled —
accepts a browser WebSocket connection carrying nothing but its `agent_id`, which is
what makes this possible on GitHub Pages at all. No API key ever reaches the browser,
because the browser never needs one.

The API key lives in exactly one place: the environment of `scripts/sync-agent.js`,
run by hand from Charlie's laptop. That script is deliberately **not** wired into
`npm run build`. A build that needs a credential is a build that eventually leaks one,
and the corpus changes far less often than the site does.

### How the connection is made

The client transport was decided by a spike, before anything else was built. Three
rungs were considered:

| | Cost | Assessment |
|---|---|---|
| Official `<elevenlabs-convai>` widget | one script tag, 200KB+ from unpkg | **Rejected.** Shadow DOM, their orb, their type. It cannot be made to look like this site, and it forecloses the animation entirely. |
| `@elevenlabs/client`, bundled and self-hosted | esbuild at build time, committed to `/static/` | Full custom UI. Exposes `getOutputByteFrequencyData()` and `getInputVolume()` — precisely the two signals the animation needs. Risk: the package pulls in `livekit-client` for its WebRTC transport, which is large, and forcing `connectionType: "websocket"` may not tree-shake it out. |
| Raw WebSocket, hand-written | ~250 lines, no dependencies, ~5KB | `getUserMedia` → AudioWorklet → downsample to PCM16 at 16kHz → base64 → `user_audio_chunk`. Server returns base64 PCM `audio` events; queue and play them; flush the queue on `interruption`; answer `ping` with `pong`. |

**The rule was: bundle the SDK websocket-only, measure it gzipped. Under 40KB, ship
it. Over 40KB, hand-roll the WebSocket.** The threshold was chosen so the whole feature
stays smaller than a single photograph, and so a decision that is really about taste
gets made against evidence instead.

**Measured, 5 September 2026: 160KB gzipped. The SDK is out; the client is
hand-written.**

`@elevenlabs/client` 1.24.0 declares `livekit-client` as a hard dependency and imports
it statically from `WebRTCConnection.js`, which the package's single entry point
reaches. esbuild therefore cannot drop it, and `package.json` exposes no websocket-only
subpath — only `.`, `./internal`, `./internal/unity` and `./worklets/*`. Reaching past
those into `dist/utils/WebSocketConnection.js` by hand would work today and break on any
minor release, which is a worse dependency than none.

160KB gzipped is roughly four times the weight of every other page on this site put
together. It is not a close call, and the margin is wide enough that a future release
would have to change the SDK's architecture, not merely trim it, to reopen the question.

The hand-written path is not a hardship. It hands you the raw PCM for both directions,
which makes the animation easier rather than harder — one `AnalyserNode` per stream,
with no SDK abstraction in between — and it is the option most in keeping with a site
that is otherwise entirely hand-built.

### The wire protocol

Confirmed against the ElevenLabs AsyncAPI reference, so the client is written against
exact shapes rather than a guess.

The client sends `{"user_audio_chunk": "<base64>"}` for microphone audio, and answers
every `ping` with `{"type": "pong", "event_id": <n>}`. A missed pong drops the
connection, so it is not optional.

The server sends, each in its own envelope:

| Event | Payload |
|---|---|
| `conversation_initiation_metadata` | `conversation_initiation_metadata_event.{conversation_id, agent_output_audio_format, user_input_audio_format}` |
| `user_transcript` | `user_transcription_event.user_transcript` |
| `agent_response` | `agent_response_event.agent_response` |
| `audio` | `audio_event.{audio_base_64, event_id, is_final}` |
| `interruption` | `interruption_event.event_id` |
| `ping` | `ping_event.{event_id, ping_ms}` |

The audio formats are **negotiated, not assumed**: the metadata event names them as
`pcm_<rate>`, so the client parses the rate out of that string and configures its
resampler and its playback buffer from what the server actually said. Hardcoding 16kHz
would work until the agent's output format was changed in the dashboard, and would then
fail as garbled audio rather than as an error.

### How the agent knows about Charlie

This falls out of the existing build. `scripts/build.js` already renders every page and
every post; a new `buildCorpus()` runs in the same pass and emits the whole site as
plain text. That artefact ships as `/llms.txt`, which is worth having on its own terms.

`scripts/sync-agent.js` then pushes the corpus to the agent's knowledge base and
updates its system prompt from `agent/prompt.md`. Keeping the prompt in the repository
rather than in the ElevenLabs dashboard means it is versioned, reviewable and diffable
like everything else here.

## Files

| File | Role |
|---|---|
| `pages/ask.html` | Content fragment: heading, a line of copy, suggested questions, the mount point |
| `site.json` | Nav entry and description; an `agent` block holding the public agent id |
| `agent/prompt.md` | System prompt, sectioned `# Personality` / `# Environment` / `# Tone` / `# Goal` |
| `scripts/build.js` | `shell()` gains a `voice` flag so the stub ships on `/ask/` alone; new `buildCorpus()` |
| `scripts/sync-agent.js` | Manual, exposed as `npm run agent:sync`. Reads `ELEVENLABS_API_KEY` from the environment |
| `static/voice.js` | The client — bundled or hand-written, per the spike |
| `static/style.css` | Roughly 60 lines added |
| `llms.txt` | Generated corpus, committed like every other build output |

`sitemap.xml` and `robots.txt` need no change: `buildSitemap()` reads the same page
list, so `/ask/` announces itself the moment its `site.json` entry exists.

## The page

`/ask/` is an ordinary page — accent line, the name and index in the left column, "Ask"
as an `h1`, one sentence of copy, and a list of five suggested questions in plain text.

That list is the fallback when JavaScript is off. It is not a placeholder and not an
apology: it is genuinely useful content that happens also to seed the conversation for
everyone else. Below it sits a single control, styled as a text link in `--link` blue,
like every other link on the site.

The transcript accumulates below the control and reuses existing tokens exactly.
Speaker labels take `.byline` — 10px, `#aaa`, already defined. Turns are body prose:
`#333`, `line-height: 18px`. Nothing new enters the type scale, and the conversation
renders as the site's own writing.

## States

```
idle → mic permission → connecting → listening ⇄ speaking → ended
                     ↘ denied                 ↘ error
```

Each state is expressed by the accent line and by nothing else. There are no status
labels: colour carries whose turn it is, which is the whole point of the animation
below. Errors are the exception — a denied microphone or a dropped connection prints
one line of prose in `.byline` grey, because a silent failure in a voice interface is
indistinguishable from a broken one.

## The animation

The site already has exactly one ornament: the 64×2px cyan gradient line above
Charlie's name, on every page, his single addition to Collison's design. **That line
becomes the voice interface.** No new visual element is introduced; the one thing that
is already his comes alive.

| State | The line |
|---|---|
| Idle | 64px, static, as it is on every page today |
| Connecting | Full measure width, a slow pulse along the gradient |
| Listening | A waveform in `#333` — the same colour as body copy, because this is the visitor's own voice |
| Speaking | The same waveform in `--accent` cyan |
| Ending | Collapses back to 64px |

The waveform itself is an array of rounded rects, 18px tall — one `line-height`, so it
sits in the text flow rather than on top of it. Width and gap are the fixed values: 2px
bars on a 5px pitch (2px bar, 3px gap), because a fixed bar count fattened to fill a
wide column reads as a chunky bar chart, not the hairline waveform this wants. Fixing
the pitch instead means the count has to follow the container — one bar per 5px of the
measure, so roughly 100 of them at 500px, with 24 as the floor for anything narrower.
That count only shows up once the line has spread into a waveform, though: at rest,
whatever the count, the bars pack edge-to-edge with no gap into exactly 64px — the same
width as `.accent` — so the idle state is pixel-identical to the mark that was already
on every page. Heights come from `getByteFrequencyData` on a logarithmic scale.

The thing that makes Wispr Flow's animation feel liquid rather than twitchy is that
amplitude never drives a bar directly. It drives a *target*, and each bar eases toward
its target at roughly 0.25 per frame. Idle is a slow sine breathing at 1–2px, never
dead flat. State changes are 120ms ease-out. No spring overshoot, no bounce, no
shadows — the same restraint as the rest of the stylesheet.

Under `prefers-reduced-motion`, the bars hold at a static level and the transcript
carries the interaction on its own.

## Agent configuration

Guardrails are configured on the platform, not written into the prompt, so they hold
independently of the model. They are what make "speaks about Charlie" survive contact
with an adversarial visitor:

- `focus` — keeps the conversation on the site's subject matter
- `prompt_injection` — a public agent carrying his name is a standing target
- one custom blocking rule — do not speculate about Charlie beyond the site's content;
  say you don't know

Without these, a public agent with his name on it will confidently invent a biography
for him, and it will sound entirely plausible.

## Build order

**Phase 2 lands before any pixels.** If the answers are bad the animation is worthless,
and answer quality is completely testable before a single pixel exists.

1. ~~**Spike** — bundle the SDK websocket-only, measure gzipped, apply the 40KB
   rule.~~ **Done, 5 September 2026: 160KB gzipped, so the client is hand-written.**
2. **The agent** — create it, write `agent/prompt.md`, build the corpus and the sync
   script, then test it in the ElevenLabs dashboard with no interface whatsoever.
3. **Page shell** — `/ask/`, the nav entry, the description, the fallback list, the
   loader stub. No animation, no connection.
4. **Connection** — states, transcript, interruption, error paths, iOS.
5. **Animation** — the accent line, the bar array, reduced motion.
6. **Documentation** — amend `CLAUDE.md`.

## Testing

Verification is tiered, because the three parts of this feature fail in completely
different ways and only one of them is testable the usual way.

**Build-script logic — automated, `node --test`.** `buildCorpus()` is ordinary pure
function work: given pages and posts, produce text. Node's built-in test runner needs
no installation and adds no dependency, so it costs nothing, and it is not the
jest-or-vitest install that `CLAUDE.md` is right to have avoided. This is a narrow,
deliberate addition — bare `node --test` covers the build, and nothing else.

**Answer quality — automated, on the platform.** ElevenLabs' own agent tests, using
their `llm` and `simulation` types, cover what the agent says and, more importantly,
what it refuses to say. That is the part that actually matters, and it runs server-side
without any of it landing in this repository.

**The browser client and the animation — manual, against a fixed list.** Testing real
microphone capture and Web Audio playback would mean jsdom, a headless browser and a
synthetic media stream: a large amount of infrastructure to assert things a person can
check in a minute. The list is Chrome, Safari, iOS Safari, microphone denied,
connection dropped mid-turn, interruption mid-sentence, `prefers-reduced-motion`, and
JavaScript off. iOS Safari requires audio to begin inside the click handler, so it
constrains the interaction design rather than being a browser to check at the end.

## Risks

**The cost tap cannot be closed without a backend.** A public agent id on a static site
is, by construction, something anyone can point a script at. Signed URLs would fix it
and signed URLs need a server. The defence is a hard monthly credit cap and low
concurrency on the workspace, and the accepted failure mode is that abuse takes the
feature dark until Charlie notices. This is a conscious trade, not an oversight.

**`CLAUDE.md` is amended, not appended to.** The two-request claim and the
zero-JavaScript claim were absolutes, qualified once. After this they are a stated
principle — nothing loads before an interaction — with the request count as its
consequence rather than its definition.

**The knowledge base can go stale.** The corpus is generated by the build but pushed by
hand, so the agent can lag the site. Acceptable, and preferable to a build that needs a
credential; the sync is one command and belongs in the release routine.
