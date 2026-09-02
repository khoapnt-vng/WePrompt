# Retention ruling — nothing current is lost, and removal is deliberate

The last owner decision before the Phase 6 schema freeze. It exists because two commitments
that both look obvious contradict each other once anything accumulates.

**The promise**, from CS3 and carried into the bin: *"Nothing here is in the film; nothing
here is lost."* The Runs answer put it more bluntly — *"nothing is deletable."*

**The proposal**, from the schema decisions: replace a Piece's current asset only through an
explicit reviewed action, and keep the old asset as bounded superseded provenance, retaining
the newest five versions per Piece.

A bound means the sixth version **is** lost, silently, by a rule rather than by a person. So
either the promise is narrower than it reads, or the bound is wrong. The designer has already
separated the two and handed the question here:

> "'Nothing is lost' is a promise about a person's work, not a storage policy. Frames
> accumulate, projects are abandoned, and someone will eventually ask to have a face removed.
> That is an owner ruling, not a surface — and the bin is where its consequence would land, so
> it is worth deciding before Pilot rather than after."

---

## The rule

### 1. The promise is about current work, and says so

**Nothing current is lost.** The promise covers the current asset of every Piece, every Piece
in the bin, and the provenance record of everything ever made. It does **not** cover the bytes
of superseded versions.

State the narrowing in the copy rather than leaving it implied. The bin's line stays exactly
as CS3 wrote it, because it is true of the bin: nothing in the bin is lost. What changes is
that we stop implying it of every byte the product has ever written.

### 2. Superseded versions are bounded by bytes, not by count

**Recommend rejecting "newest five per Piece"** and bounding a project's superseded history by
a byte budget instead.

Measured on the current dev profile: 170 stills, 188 MB, **mean 1.11 MB**, max 2.20 MB. So
five-deep retention on a maxed-out 96-Piece project of photographs costs about **0.53 GB** —
which is nothing, and means the bound buys us nothing for stills.

Phase 6 introduces video, and a clip is one to two orders of magnitude larger than a still.
The same rule then costs tens of gigabytes for the same project shape. **A count applied
across a 100× size range is not one policy, it is two policies wearing one number** — too
tight for photographs, far too loose for film. This machine has already been filled to 100%
once by accumulated build output; the failure mode is not hypothetical.

A byte budget adapts without anyone re-arguing the number when the media changes.

### 3. Permanent removal exists, and lives in project settings

Accept the designer's placement verbatim:

> "If permanent removal ever exists, my recommendation is that it lives in project settings
> and never on this line: a person tidying a canvas should not be one click from destroying
> something."

Two acts, both in settings, both confirmed, neither on the canvas:

- **Remove one Piece's history** — drops superseded bytes, keeps the current asset.
- **Delete a project** — the only act that removes current work, and the only place the
  promise is deliberately broken by a person who said so.

### 4. Eviction is never silent, even when the bytes are gone

When a superseded version is evicted, **the provenance record that it existed survives**. The
bytes go; the fact does not. A person looking at a Piece's history sees that a version was
made, when, at what cost, and that it is no longer stored.

This is what lets Pilot 1's requirement — *"reload it with stable identity and exact
provenance"* — stay true while bytes are reclaimed. Provenance records are text and cost
nothing; it is the frames that accumulate.

### 5. The bin is not a deletion queue

**Lift-to-bin never evicts anything.** Bin items are retained exactly like current work, and
retention pressure must never fall on them.

This follows from the bin as drawn: bin items already count toward the 96 ceiling, `Put back`
restores a Piece with the status it left with, and the whole surface is built on the claim that
nothing there is lost. If tidying could trigger eviction, tidying would become destroying —
the precise thing the designer's placement argument exists to prevent.

### 6. A removal request is not a tidying feature

The designer's example — *"someone will eventually ask to have a face removed"* — is a consent
matter, not housekeeping, and it has a harder requirement than a byte budget: removal must be
**complete**. Superseded versions, bin contents, exported artifacts and provenance thumbnails
all have to be reachable by it.

Nothing in Phase 6 needs to build that. It does need to not make it impossible: every asset
must remain addressable from the Piece that owns it, so a later removal path can find all of
it. That is a schema property and belongs in the freeze.

---

## What this asks of implementation

Nothing large, and less than the proposal it replaces.

- A per-project **byte budget** for superseded assets, with the number set from real media
  sizes rather than guessed. Stills are ~1.1 MB; set the video figure from the first real
  clips rather than now.
- **Eviction oldest-first within a Piece**, never across Pieces, so one busy Piece cannot
  evict another's history.
- A **provenance tombstone**: the version record, minus the bytes.
- **Bin membership exempt** from eviction.
- Every asset **addressable from its owning Piece**, so a future removal path is complete.

---

## Consequence for the sequence

This closes the last owner-side item before the schema freeze. It touches the freeze in one
place only — item 6, addressability — and that is a property of how assets hang off a Piece,
not a new contract.

The byte number itself does **not** need to be settled before the freeze, and should not be:
it is a configuration value, and the honest input for video does not exist yet. What the freeze
needs is the shape — budget rather than count, tombstones retained, bin exempt.

---

## Three things to argue with

1. **Bytes over count.** It is the right bound and it is harder to explain to a person than
   "we keep the last five".
2. **The promise is narrowed in copy.** Saying "nothing current is lost" out loud is more
   honest than the current phrasing and slightly less reassuring than it.
3. **Project deletion is the one place the promise breaks.** Defensible, and it should be the
   only one.
