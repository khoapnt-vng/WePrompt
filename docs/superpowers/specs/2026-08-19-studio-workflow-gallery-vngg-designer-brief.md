# Creative Studio — Workflow Gallery for VNG Games · Designer Brief

- **Date:** 2026-08-19
- **Feature owner:** Minh (minhtq4)
- **Target:** Creative Studio inside WorkUp (Electron desktop, Arco Design + Studio's own typography scale)
- **Status:** POC. Gallery + modal shell already exists in the app; this brief defines the **content and concept** that fills it.
- **What we need from you:** the gallery surface, the workflow modal, and the Game Pack moment — in the app's existing Studio visual language, dark theme first.

---

## 1. What this is

A catalog of guided starting points for Creative Studio, aimed at **VNG Games**. The user picks a card ("Patch-note explainer"), answers a short fill-in-the-blank sentence, and Studio produces a finished piece of community content.

The reference is InVideo's workflow gallery: category rows of cover-art cards, and a modal that reads as a sentence with dropdowns in it rather than a form.

**We keep** the row/card layout, the sentence-shaped modal, the optional setting chips, the single Proceed button.

**We change** the one thing that matters: where the blanks come from.

---

## 2. The concept

> In the reference tool, the blanks are filled from thin air.
> In ours, **the blanks are filled from the Game Pack.**

A **Game Pack** is a per-title bundle that every card inherits:

| Layer | Contents |
| --- | --- |
| Assets | key art, character renders, logo lockups, UI kit, colorways, cleared BGM/SFX |
| Knowledge | lore, character bios, patch history, event calendar, in-game glossary |
| Rails | tone rules, banned topics, ratings lines, competitor policy, required legal super |
| Voice | how *this* community actually talks — per title, per region |

The sales line is **"on-model by construction."** A generic AI video tool makes a good-looking short that is subtly wrong — wrong character, wrong logo lockup, a claim legal would not clear. For a publisher that is not a small gap; it is the whole objection. Our modal opens already knowing the game.

**Design implication:** the pack must be *visible* in the modal. When a user opens "Patch-note explainer" they should immediately see that the game, the patch, the voice, and the rails are already chosen — not blank fields waiting for them.

---

## 3. Who uses it

Two audiences, one gallery. Cards are tagged for both; there is no separate app.

1. **VNGG community / marketing team** (internal) — high volume, everything unlocked. This is the primary POC audience.
2. **KOLs and partner creators** — a reduced, brand-locked card set. In the POC this is a *card group*, not a permissions system.

**Engineering dependency (not a design concern, but it shapes what §5 can honestly promise):** Studio does not render video today — ffmpeg was agreed as the route and spiked *out* of sprint 2. The video-output cards ride on the trailer workflow currently in build. Cards whose output is a still image or a document are unblocked now.

Out of POC scope: players themselves, per-user quotas, moderation, spend caps, creator provisioning. Those are real products and are priced separately.

---

## 4. Surfaces to design

### 4.1 Gallery

Category rows, horizontally scrolling, each row a titled band of cover-art cards — the reference layout. Five rows (§5). Design for a sixth appearing later.

**Card anatomy:**
- Cover image (16:9-ish, art-directed, text baked into the art like the reference)
- Card title, 1–3 words, set in the art
- Platform icon strip, bottom-left — TikTok, YouTube, Facebook, **Zalo**, Discord
- Optional corner badge: `Needs Game Pack` vs pack-free (see §7 build order — this distinction is load-bearing for the demo)
- Optional badge: `Creator` for the KOL-facing row

**States to draw:** default, hover, focus (keyboard), pressed. Row overflow affordance. Empty gallery (no packs installed yet) — this state should sell pack creation, not apologize.

### 4.2 Workflow modal

Opens on card click. Reference structure, top to bottom:

1. **Hero** — the card's cover art, bleeding to the modal edges, title over it, favourite/heart affordance, close.
2. **The sentence** — the core of the design. Inline dropdowns and a free-text topic field composed into readable prose. Example:

   > Explain **[patch 3.7]** for **[YouTube Shorts]** in a **[casual]** voice about ⟨topic⟩

   Dropdowns are underlined inline controls, not boxed selects. They must read as a sentence at a glance and still be obviously interactive. **Vietnamese sentence order differs from English** — the layout must survive re-ordering by locale, so treat the sentence as a token stream, not a fixed 3-column grid.
3. **Pack strip** — new vs the reference, and the whole differentiator. A compact row showing which Game Pack is active: title lockup, patch version, rails-on indicator. Changeable inline. This should feel like a *provenance* line, not another form field.
4. **Settings chips** — collapsed by default, `+` to expand each (reference behaviour). Chip taxonomy in §6.
5. **Footer** — Back / Proceed.

**States to draw:** default, a chip expanded, validation (topic empty), no-pack-selected on a pack-dependent card, generating/submitting.

### 4.3 Game Pack moment

The demo's strongest beat and the surface with no reference to copy.

The pitch is *"give me your game, watch it become yours."* A user drops in five assets, a logo, last patch's notes and a tone line, and every card in the gallery is now about their title. Design:

- **Pack picker** — switching the active pack, from the gallery header and from inside the modal
- **Pack creation** — a short guided flow: name/title, drop assets, paste patch notes, tone line. Must be completable in about five minutes on stage.
- **Pack card** — how a pack is represented once it exists (cover, title, asset count, patch version, rails status)

### 4.4 Handoff to Studio

Proceed closes the modal and lands the user in Studio's existing views (Table / Board / Cut) with the brief pre-filled. Design the transition and the "this was launched from *X* card" provenance affordance so the user can get back to the modal's choices without redoing them.

---

## 5. The catalog

Twenty cards, five rows. Sentence templates are the modal copy; bracketed spans are dropdowns filled by the Game Pack.

### Row 1 — Hype the drop *(fires on the live-ops calendar)*

| Card | Sentence | Output |
| --- | --- | --- |
| Season teaser | Tease **[Season 4]** for **[TikTok]** with a **[mysterious]** tone | 20s vertical, key art + motion, no VO |
| Countdown loop | Count down **[3 days]** to **[event]** | 6s loop, 3 variants (3/2/1 day) |
| Collab reveal | Reveal the **[X × Y]** crossover | 30s, both IPs on-model |
| Event recap | Recap **[last weekend's event]** | 45s, stats pulled from the pack |

### Row 2 — Explain the game *(the retention content nobody has time to make)*

| Card | Sentence | Output |
| --- | --- | --- |
| **Patch-note explainer** | Explain **[patch 3.7]** for **[YouTube Shorts]** in **[casual]** Vietnamese | 45s, buffs/nerfs from the real notes |
| Hero kit breakdown | Break down **[new hero]**'s kit | 40s, ability-by-ability, on-model renders |
| First 24 hours | Onboard a new player to **[title]** | 60s beginner guide |
| Meta tier list | Rank **[top 5 heroes]** this patch | Listicle format, grounded in patch data |

### Row 3 — Community voice *(what actually gets shared)*

| Card | Sentence | Output |
| --- | --- | --- |
| Meme from a moment | Make a **[meme]** about **[that boss wipe]** | 15s, community dialect |
| Players be like | Sketch **[every support main]** | 20s skit, character assets |
| Debate bait | Ask the community **[which skin is worth it]** | Poll-shaped short + caption pack |
| Player shoutout | Celebrate **[player/guild]** | 15s, screenshot-driven |

### Row 4 — Creator kit *(the KOL half — tag these `Creator`)*

| Card | Sentence | Output |
| --- | --- | --- |
| Brief → script | Brief a creator on **[Season 4]** in **[their]** voice | Script + shot list + rails |
| **Hook lab** | Give me **[12]** openings for **[this clip]** | 12 hooks, ranked |
| VOD cutdown | Cut **[this stream]** into shorts | 5–8 clips, auto-titled |
| Thumbnail + title lab | Thumbnails for **[this video]** | 9 variants, brand-checked |

### Row 5 — UGC-style ads *(UA performance)*

| Card | Sentence | Output |
| --- | --- | --- |
| Comeback testimonial | "Why I returned after **[2 years]**" | 30s, creator-style, handheld feel |
| Gameplay + VO ad | Screen-record ad about **[feature]** | 25s, authentic-scrappy |
| Progression flex | Before/after **[rank climb]** | 20s, satisfying arc |
| Chat-hook ad | Fake-DM hook about **[event]** | 15s, scroll-stopper |

---

## 6. Setting chips

Generic tools ship Language / Subtitles / Voice / Music. Ours ships those plus the chips that prove we know this market. The SEA-specific ones are marked ★ — they carry disproportionate weight in the room and deserve visual priority.

| Chip | Values |
| --- | --- |
| ★ Voice | VN male / female **× Northern / Southern accent** |
| ★ Register | hype caster · chill guide · meme goblin · lore narrator |
| ★ Language | VN first, then TH / ID / EN |
| ★ Music | *Game OST* (cleared) vs *trending audio* (flagged — not cleared) |
| ★ Platform | TikTok · YouTube Shorts · Facebook Reels · **Zalo** · Discord — 9:16 default |
| ★ Patch version | grounds every factual claim |
| Spoiler level | for story/lore content |
| Brand rails | legal super, banned topics, top-up ("nạp") framing |
| Subtitles | on/off, burned-in vs sidecar |
| Watermark | text/logo |
| Length | per-card default, adjustable |

Two of these need distinct visual treatment because they are *warnings*, not preferences: **trending audio (not cleared)** and **brand rails off**. Both are states a publisher's legal team cares about. Don't bury them in a generic chip.

---

## 7. POC build order

**Phase 1 — pack-free cards.** Hook lab, VOD cutdown, thumbnail + title lab, comeback testimonial, gameplay + VO ad. These run off footage the user supplies. Nothing to license, nothing to wait for, works day one.

**Phase 2 — Game Pack + hero card.** Pack creation flow, then **Patch-note explainer** as the hero.

**Why that hero:** it is the least fakeable card in the catalog. You paste real patch notes and get a correct, on-model 45-second Vietnamese short. A generic tool physically cannot do it, VNGG ships patch notes every two weeks forever, and it is the demo where someone in the room asks to run it on *their* title.

**Second beat:** Hook lab. Twelve variants appearing at once is visceral in a way one good video is not.

---

## 8. Copy and localisation rules

- All copy through i18n. **Vietnamese runs long** — the sentence in the modal must not break when a dropdown label doubles in width.
- Card titles are 1–3 words and live in the cover art. If a title cannot survive translation inside the art, it is the wrong title.
- The sentence is prose, not labels. "Explain patch 3.7 for YouTube Shorts" — never "Topic:" / "Platform:".
- Raw technical names (model ids, MCP server names, internal card slugs) never appear on any surface.

---

## 9. Design-system constraints

- Studio's existing visual language — dark theme first, its own typography scale (three typefaces are already loaded; match the existing Studio surfaces rather than introducing a fourth).
- Arco Design components underneath. Two known traps worth knowing before you spec anything unusual: Arco moves your class onto a wrapper `<span>` when a Button is disabled, and a background on a text Button is outranked by Arco's own selector. If a state depends on either, flag it and we will solve it in CSS rather than have it silently not ship.
- Design light **and** dark. Desktop widths only for the POC.

---

## 10. Selling to leadership

*This section is not design work. It is here because three of the decisions above — which surface gets the most craft, how Row 3 is treated, and what the demo path is — only make sense once you know what the room is buying.*

### What VNGG leadership actually buys

Ranked. The order matters more than the list.

1. **UA creative volume.** The only argument that is about revenue rather than cost. Paid user acquisition is bottlenecked on creative fatigue — ROAS decays as variants age, and teams cannot produce hooks fast enough to stay ahead of it. "Twelve ranked hooks in ten minutes" is a media-efficiency number that shows up in a dashboard they already read.
2. **Time-to-moment.** A meme has a 24-hour half-life; a patch explainer is worth an order of magnitude more on day one than on day five. Most of that window is lost to briefing, agency turnaround and approvals. Compressing patch-drop-to-published from days to hours is a legible operational win.
3. **Portfolio leverage.** A title GM cares about their game; a publishing head cares that one pack factory serves the whole portfolio and that the twentieth pack costs almost nothing to build. The Game Pack is the unit being sold, not any individual card.

Cost-per-asset versus agency spend is real but belongs fourth. Leading with it invites a procurement conversation instead of a pilot.

### The objection that decides the meeting

**Gamers are the most AI-hostile audience on the internet.** A publishing leader has watched other brands get shredded for visible AI content, and their first instinct will be that this points brand risk directly at their most passionate users. If we do not raise it first, they will, and the rest of the conversation is spent defending.

The answer is to sort the catalog by where AI is *defensible*. This usefully inverts the row order in §5:

| Risk | Cards | Why it holds up |
| --- | --- | --- |
| **Safest** | Row 5 — UA ads | It is paid advertising. Nobody expects an ad to be handmade, and it is judged on ROAS, not sentiment. |
| **Safe** | Row 2 — patch explainers, tier lists, onboarding | Utility content. Players want the information; craft is not the point. Localisation sits here. |
| **Safe** | Row 4 — creator kits, briefs, hook labs | Internal or creator-facing. Never ships as-is; a human always finishes it. |
| **Handle with care** | Row 3 — memes, "players be like" | This is AI impersonating community voice. Highest backlash surface in the catalog. |

Stating this out loud — including that Row 3 would be gated — buys more credibility than any demo. It signals we understand their audience and not merely their workflow.

### Design implications

- **Row 3 needs a visible treatment**, not a hidden one. A card group that reads as deliberately gated ("review before publishing") is an asset in the pitch. A meme generator sitting undifferentiated between a patch explainer and a UA ad is a liability.
- **The Game Pack creation flow (§4.3) is the hero surface for this audience**, not the finished video. It deserves the most craft in the whole brief.
- **Hook lab needs a result view that shows volume at a glance** — twelve variants visible at once, not a list you scroll. The volume argument has to be seen, not counted.

### The demo path for a leader

Different from the designer-facing hero. The beat is *"give me your game"*: build a pack live on their own title in five minutes — assets in, patch notes pasted, tone line set — then run the patch explainer. What lands is not the video quality; it is that the tool became theirs during the meeting. Follow immediately with Hook lab on their key art.

### The ask

Not adoption. The format that already runs here: **a two-week skill sprint with one title's community/UA team, scoped to a single metric they already report** — variants shipped per campaign, or hours from patch drop to content live.

A small, reversible commitment with a number at the end is the shape of ask that gets a yes in a room where nobody wants to sponsor a platform.

---

## 11. Open questions

1. **Which title do we instantiate the pack on for the demo?** Needs five assets and one patch note. If none can be cleared in time, the live pack-creation flow carries the demo instead — which is why §4.3 is not optional.
2. **Cover art sourcing** — the reference gallery's covers are stock. Ours can be too, avoiding IP exposure entirely, or we can art-direct a set. Cheaper vs sharper.
3. **Card count for the POC gallery** — all twenty drawn as covers with five functional, or a trimmed gallery where everything visible works? The first demos better; the second survives someone clicking around unsupervised.
