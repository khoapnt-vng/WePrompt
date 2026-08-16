# The still→clip experiment

One hour, three paid generations, no code. It decides whether Phase 3a is worth 12–17 days.

**The claim under test:** a still produced by a real image engine, fed to a real video engine as a
clip's first frame, yields a clip that visibly continues from that still — and two clips built from
the same still look like they belong in the same film.

`e2eFakeAdapter` proves that the plumbing carries a field. It cannot prove two real models agree
about a face. The 2026-08-15 controlled OpenRouter result below is the completed real-provider
still-to-clip admission gate for that route; it is not evidence that the result transfers to
BytePlus or that multi-image conditioning is available.

---

## Two questions, deliberately separated

Conflating them is the trap: a plumbing failure looks exactly like a coherence failure, and would
kill a phase that was never actually tested.

**Q1 — mechanical, objective.** Does the still actually arrive as the video's first frame?
Answered by extracting frame 0 of the output and comparing it to the still. No judgement involved.

**Q2 — perceptual, human.** Does the rest of the clip belong with that still — same subject, same
light, same world? Answered by eye, by someone who did not write the prompt if possible.

**If Q1 fails, Q2 is unanswerable.** Report it as plumbing and re-run; do not record a verdict on
coherence.

---

## Preconditions

- **Explicitly select the image and video engines in the project's Engine Strip.** Multiple routes
  may be bound; record the intended integration as well as provider and model, then verify both
  current project choices immediately before spending.
- **The video engine must report first-frame support.** If it does not, the whole mechanism is
  unavailable on that engine and the experiment is answering a different question. Check before
  spending.
- **Shot duration ≥ 4 seconds.** The engine floor is 4s and authoring still accepts 1–3s, which fails
  at render — after the money.

## S1.5 is no longer the technical blocker; the route-specific control has run

The current branch has explicit project-level image and video selection, so S1.5 no longer prevents
this experiment. The successful controlled OpenRouter run recorded below supplies the required
route-specific provider evidence and same-film coherence sign-off, admitting Phase 3a Task 1. It
does not prove multi-image capacity, exact face/cast identity, flawless motion or physics, or any
result on BytePlus.

**A project was prepared during the earlier attempt**, with zero spend recorded at that point:

- project `dbf35861_0614_4cb3_9465_0baee3304e79`, one shot, output **Video**, length **5s** (above the
  4s engine floor)
- visual prompt carrying the two checkable attributes: _a red-and-white horizontally striped scarf_
  and _a polished brass telescope_, on a rain-wet cobblestone street at night
- nothing generated; **zero spend was recorded during preparation**

Before spending, verify that the prepared project still exists, that its prompt, output mode and
duration remain as described, and that its current image and video choices name the intended routes
and integrations. If any of that has drifted, repair or replace the project before step 3; do not
infer current state from this note.

## Protocol

1. **New project**, one shot. Landscape 16:9 is fine.
2. **Write a visual prompt with at least two specific, checkable attributes** — not "a woman in a
   city" but "a woman in a **red-and-white striped scarf** holding a **brass telescope**, on a rain-wet
   street at night". Vague prompts make drift unfalsifiable: you cannot tell a coherence failure from
   a prompt that never specified anything.
3. **Verify the current project routes, then generate the still** — confirm the Engine Strip's image
   and video choices, including integrations, before using the reference-image control on the shot's
   visual cell.
4. **Render the shot as video**, with that still as its first frame.
5. **Second clip from the same still**, different action, same attributes. This is the product claim
   and it is a different question from step 4.

Three paid generations: one still, two clips.

## What to record

Save all of it — this is the evidence, and a screenshot of a verdict is not evidence.

- image engine + video engine, model names and integrations
- the still
- both clips
- **frame 0 of each clip**, extracted, beside the still
- the last frame of each clip
- shot duration used, and any warning shown before spending

## Reading the result

| outcome                                                                 | meaning                                                   | what to do                                                                                                         |
| ----------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Q1 fails** — frame 0 is not the still                                 | plumbing, not coherence. The premise is still untested.   | Fix and re-run. Cheap, and it is a bug worth having found.                                                         |
| **Q1 passes, Q2 passes** on both clips                                  | the mechanism works and buys real coherence               | Plan 3a. This is the result the programme assumes.                                                                 |
| **Q1 passes, Q2 fails within one clip**                                 | the engine accepts the frame and then drifts away from it | 3a as designed does not deliver coherence. **This is the phase-killing result and the most valuable one.**         |
| **Q1 passes, within-clip holds, the two clips do not match each other** | continuation works, shared conditioning does not          | 3a is narrower than promised: it buys continuity inside a clip, not a consistent film. Re-scope before committing. |

## Why this was worth an hour before planning

Phase 3a is 12–17 hand-days, and the programme plan puts it **before** the expensive model
restructure precisely so coherence is proven early. The controlled OpenRouter result below admitted
Task 1 for that route before implementation started. Its limitations remain explicit: it is not a
multi-image capacity proof, it did not use an explicitly different-action prompt, and it does not
transfer to BytePlus.

The handoff is explicit that this is the strongest lever available — _"two clips with identical refs
and sloppy prompts match better than two with careful prompts and different refs"_ — and that
prompt wording is the weakest. If that ranking is wrong on the real engines, the whole coherence
strategy changes, and it is better to learn it from three generations than from three weeks.

## Not in scope

The last-frame chain — clip 2 starting from clip 1's final frame — is Phase 3b and needs sections.
This experiment tests **still → clip**, once and twice, not clip → clip.

## 2026-08-15 failed case — Scarf and telescope, OpenRouter HTTP 400; cause unconfirmed

This is a request-specific failed case, not an experiment verdict. The approved still succeeded through OpenRouter with
`google/gemini-3-pro-image` / Image API; job `4d7905e1-898f-4e7c-9c00-e75cb8decec2` retained a JPEG
whose SHA-256 is `b78620a730d3539e53c8eda01a7ad2ee32571c7226adec3c6489f0b4f08ac670`. The approved Clip 1
request used OpenRouter / `bytedance/seedance-2.0` / `openrouter-video-v1`, reached canonical model
`bytedance/seedance-2.0-20260414` at Seed, and failed with HTTP 400 after 3.9 seconds and one attempt.
The dashboard displayed upstream request `gen-vid-1786754801-BRVVfG8p3G8jtHKPf5Z1`, but the app
could not have retained that ID because it persists a provider job ID only after a successful submit
response; a later `/api/v1/generation/content` lookup returned 404. Treat the value as dashboard
telemetry, not as a durable Studio job identity. Neither the original attempt nor its acknowledged
retry created a durable provider job or output. The adapter discarded the non-2xx body, and the
provider response body was not retrievable, so no provider classification or cost was visible.
Neither failure establishes that the request was uncharged.

This failed case leaves Q1 and Q2 unanswered for the Scarf-and-telescope request: there is no
completed clip, no frame 0 to compare to the still, and no coherence judgement.

The adapter supplied the managed first frame as an inline data URL. The earlier conclusion that
OpenRouter therefore required a public HTTPS publisher was wrong. Local durable evidence records four
successful 2026-08-12 OpenRouter jobs through the same adapter and standard
`bytedance/seedance-2.0` route, each with a managed first frame. The closest control, **On the Pitch**,
used the same 5s, 16:9, 720p settings and a verified 1376×768 JPEG; its provider job
`fISdRphdD2aqao9VYg4E` completed successfully. The official OpenRouter video contract also permits a
data URL for `frame_images`. The 2026-08-15 failure could instead be input-specific or an upstream
validation/routing change. Without the discarded response classification, the evidence cannot choose
between them.

The approved control was a **fresh, single-scene** named review for **On the Pitch** with its original
verified reference, standard `bytedance/seedance-2.0`, 5s, 16:9 and 720p. It did not use the failed
job's generic Retry action or widen the request into the four-scene historical batch. The adapter
records only allowlisted non-2xx classification tags; it never records a raw provider body, message,
prompt, API key, URL or data URL.

## 2026-08-15 controlled result — On the Pitch, OpenRouter admission gate passed

The approved fresh, single-scene control completed through OpenRouter integration/provider
`d1ff983b`, adapter `openrouter-video-v1`, model `bytedance/seedance-2.0`, at 5 seconds, 16:9 and
720p. It supplied the first frame as an inline managed JPEG. The project manifest was
`/Users/lap16603/Library/Application Support/Forge-Dev/config/creative-studio/3e477e8b_5ff2_44bc_8afa_4e25486b6b0d/project.json`;
the scene was `pitch_action`, **On the Pitch**.

The shared reference was asset `eeb9a494_8093_42ca_97ff_53629b77c4d9`, a 1376x768 JPEG of 716,790
bytes, SHA-256 `d8edc0009296fed8f1f75e63c9d87785c077f16e7c3562b4adfe3e8e59d37f24`.

- The original clip was job `4e251e85-33ec-4810-8b79-9ad540b7a1d8`, provider job
  `fISdRphdD2aqao9VYg4E`, video asset `5cd67fbf_7ce0_4f64_91e8_b23168ed34f6`, SHA-256
  `c535312f53abdb850ead117a655e1e37c404ec0b120d9a4881b87e07726ae80f`.
- The fresh controlled clip was job `d4549fab-91a7-40d0-b7d0-0ce9f370db18`, provider job
  `4RpWfJuDgLmdsiK7v8ww`, video asset `a7c77fa9_c994_4a0f_b57e_9e616cb3a4fb`, SHA-256
  `d8ef7b4940169b1c79134771ef7b0439397c7894d5e9c2e747789a5fe56fc72e`.

Both MP4s are 1280x720 H.264 at 24 fps, with 121 decoded frames, AAC audio and approximately 5.04
seconds duration. Q1 passed objectively: reference-to-original frame 0 SSIM was `0.898096`,
reference-to-controlled frame 0 SSIM was `0.898209`, and original-to-controlled frame 0 SSIM was
`0.985962`. Both visibly preserve the reference composition and first-frame identity.

Q2 passed for same-film coherence on this OpenRouter route. The human owner verdict was:
**“different but feel like the same for sure”**

Phase 3a Task 1 is therefore admitted.

This result remains deliberately narrow. Both clips reused the same action prompt rather than an
explicitly different-action prompt. Silhouetted subjects establish role/world continuity, not exact
face or cast identity. Sampled frames and endpoint metrics do not by themselves prove flawless motion
or physics. The successful inline first-frame control disproves the claim that this OpenRouter route
requires an HTTPS publisher; it does not transfer that conclusion to BytePlus. It also does not prove
multi-image conditioning, which remains scheduled for Task 8.5 before Task 9 / production nonzero
capability.

## 2026-08-16 Task 8.5 result — two-image conditioning admitted on one exact still route

The admission proof is the successful, unretried `submitScenes` still job
`10d2089c-b2e8-47e3-a701-cd5ac321dd8f`, scene `b4e0fa40-1b60-40d3-8f55-9ee4f2c5b92b`, project
`dbf35861_0614_4cb3_9465_0baee3304e79`. Its exact route was provider `d1ff983b`, adapter
`weprompt-image-v1`, `base_url=https://openrouter.ai/api/v1`, UI integration **Image API**, model
`google/gemini-3-pro-image`, and a maximum conditioning count of **2**. The project frame was 16:9 /
720p. This app uses the chat-completions image path; it does **not** establish support for OpenRouter's
dedicated `/api/v1/images` route. Provider image size was not explicitly requested.

The immutable ordered inputs were Cast `84fc7da2_f2a3_4394_99e5_33668a73a4c0` (`Screenshot 2026-08-16
at 07.01.17`), then Look `da00becc_295a_4f33_87a9_d54046374aab` (`Screenshot 2026-08-16 at 07.01.52`).
The unconfounded prompt was:

> Preserve the exact identity, facial features, and hair of conditioning image 1. Show her wearing a
> red-and-white striped scarf and dark coat, holding a brass telescope on a wet street at night. Use
> conditioning image 2 solely to determine the visual treatment; do not borrow its depicted content.

Output asset `6d1bf139_7107_495e_96b5_c95b615ef5a0` is a 1376x768 JPEG, 739,781 bytes, SHA-256
`9167feca52d40b6f9a6afce1f337c67ca9e455e349598b52fd78be42e0e34fb3`.

The independent, predeclared verdict was **PASS narrowly**. The Cast's elongated oval face, high arched
brows, wide-set brown eyes, narrow straight nose, mouth/cheek structure, and smile were consistent;
wet hair altered styling but not identity. The Look's amber-versus-deep-cyan/teal split lighting and
warm face highlights were visible, as were its saturated low-key color, sculpted high-contrast
rendering, shallow depth, luminous background separation, and polished portrait treatment—none named
in the prompt. No Look people, headphones, or outfits were copied.

The wet night street still encourages colored reflections, bokeh, and contrast, so attribution rests
on the combined palette, facial toning, saturation, and depth; flowers and dual-subject staging did not
transfer. This admits this exact app route and count, not causal attribution of every pixel. Job
`2f068cd4-439e-47c9-97ed-3d2c94a576f9` remains confounded preliminary evidence because its prompt also
named Look attributes, not the admission proof. This makes no video claim and does not generalize to
other providers, adapters, aliases, integrations, or image API routes.

## 2026-08-16 Task 9 checkpoint — Clip 1 stopped at OpenRouter HTTP 400

Task 9 continued from the accepted Task 8.5 still above. Before spending, a temporary third project
reference was classified as active against the selected image route's admitted maximum of two. The
Brief showed three active references, declared the maximum of two, and blocked new reference-still
generation. No review was confirmed and the project job count remained five through the blocked
state and the subsequent removal of that temporary classification. This completes the required
below-active-count no-spend control without a provider request.

The evidence scene `b4e0fa40-1b60-40d3-8f55-9ee4f2c5b92b`, **Scarf and telescope — evidence**, was
then set to Video at five seconds while retaining reference asset
`6d1bf139_7107_495e_96b5_c95b615ef5a0` (SHA-256
`9167feca52d40b6f9a6afce1f337c67ca9e455e349598b52fd78be42e0e34fb3`) and the canonical Cast-then-Look
Brief inputs. The named review showed OpenRouter provider `d1ff983b`, adapter
`openrouter-video-v1`, model `bytedance/seedance-2.0`, integration **OpenRouter video**, 5 seconds,
16:9, 720p, generated audio, and the provider-charge warning. The owner approved only this call with
the exact instruction **“approve clip 1”** immediately before Confirm.

The app submitted exactly once through `submitScenes`. Local job
`648e3740-e381-447c-aee5-5326fa053566` was created at `2026-08-16T04:12:59.465Z` and became
`needs_attention` / `submission_unknown` at `2026-08-16T04:13:04.728Z`. It has no provider job ID,
remote-start timestamp, output asset, or selected take. The allowlisted diagnostic recorded an
OpenRouter submit response with HTTP `400`, readable JSON, provider error code `400`, and a message,
but no stable error type or provider code. The raw response was not retained, so the cause and charge
status remain unknown.

The checkpoint stopped there. No retry and no Clip 2 submission were made. With no clip artifact,
Q1 and Q2 are unanswerable; this is a request/provider failure and an incomplete Task 9 acceptance,
not a coherence verdict. The exact Task 8.5 still-route admission and the earlier **On the Pitch**
OpenRouter still-to-clip result remain valid, but Phase 3a's final real-project acceptance and handoff
remain blocked pending provider/charge reconciliation and fresh, separately named approval for any
replacement Clip 1 call.

## 2026-08-16 Task 9 follow-up — one cartoon clip passed; the second fresh run failed

The checkpoint above was accurate when recorded. Acceptance later continued with a clearly fictional
2D-cartoon case in the same project. Reference job
`77dd846d-d613-4022-9038-de6e9db472b2` succeeded through provider `d1ff983b`, adapter
`weprompt-image-v1`, model `google/gemini-3-pro-image`, using the exact ordered inputs Cast
`7b915411_54aa_4775_9d6a_537a1f6ac542` (`cartoon-cast-reference`) then Look
`2e246874_9a70_4ad4_ab4e_5393dcb9d25c` (`cartoon-look-reference`). It produced the selected 16:9 / 720p
reference asset `d0051492_3116_469d_9fef_427f3c7f8160`, whose SHA-256 is
`4ea8104aef2940182b4534ab335ff82e7fb9704231fa6ec4c52d90ed97a2bd79`.

Clip 1 was a fresh five-second submission through provider `d1ff983b`, adapter
`openrouter-video-v1`, model `bytedance/seedance-2.0`, with generated audio and the selected still as
its only video-conditioning input. Local job `615f7c44-d88d-4ef1-af6d-ae86b102712e`, provider job
`YOtORU2sMGD4FnsmR0s7`, succeeded and produced MP4 asset
`c3cdc166_bed8_4713_b171_737ae979d485`, whose SHA-256 is
`9313d23ce6c887ae4d520343b21d738cbccfd372f93b0e79ef8664115e9f7e85`. The stored file is 1280x720
H.264 at 24 fps with 121 frames, AAC audio, and a container duration of approximately 5.062 seconds.
The provider visibly began from the selected still: after registration, still-to-frame-0 grayscale
SSIM was `0.939682`, luminance correlation was `0.993524`, and 97.6% of feature matches were inliers.
Visual inspection found the same illustrated woman, pose, scarf, telescope, lighting and street. The
owner explicitly concluded **“Clip 1 passes; prepare Clip 2.”** This proves the bounded Cast/Look ->
still -> one-clip visual happy path. It does **not** pass Q1's strict equality wording: the 1376x768
still was reframed into a 1280x720 decoded frame, and the quoted metrics require registration.

Clip 2 was another fresh submission, not a retry: local job
`247b2be7-5134-4337-9594-eab6886d342a` has `retryOfJobId: null`, a new provider job
`bJMLyg4PF9QhKa6Zp4Tg`, and the same scene, prompt, selected still, provider, adapter, model, duration,
frame, resolution and audio setting. It was accepted remotely and later failed with local error code
`unknown`; it produced no output asset. No retry was made, and the owner explicitly deferred the
investigation. Because this was the same prompt rather than the protocol's different-action prompt,
it was a repeated-run reliability check, not a complete substitute for protocol step 5.

Task 9 Step 5 therefore remains incomplete. Strict Q1 equality is unproven for Clip 1, and there is
no second clip, second frame-0/final-frame evidence, different-action comparison, or two-clip
coherence judgement. This is not a negative coherence verdict and does not invalidate the admitted
max-two image route, the earlier **On the Pitch** Task 1 gate, the no-spend capacity control, or the
successful single-clip cartoon path. Phase 3a engineering is complete locally; its original final
acceptance remains deferred.
