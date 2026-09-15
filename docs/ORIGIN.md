# Why this shape

A design note. It explains the two decisions in this package that are not
obvious from the API, so that a future change does not quietly undo the reason
they were made.

## Two apps converged on the same shape, and they were not the same underneath

This package exists because two unrelated applications independently built
"lanes with things positioned along an axis" before either of them thought of it
as a component.

- A **drafting app** had a plot timeline. Lanes were plotlines. An item's
  position was a continuous fraction of the whole story, and a board carried
  something like 79 beats.
- A **planning tool** had roadmap lanes. Lanes were workstreams. An item's
  position was a named horizon — `now`, `next`, `later`, `dated`.

Two teams reaching for the same picture is the signal that a shape is real
rather than a novelty. The trap is what you do next.

The obvious move is to pick the more sophisticated one — the continuous
pacing math — and make the other app express its buckets as fractions
(`now = 0.0`, `next = 0.33`, …). It compiles. It even renders. And it is wrong,
because it quietly answers questions the bucket model has no answer to:

- What is *between* `now` and `next`? On a continuous axis, `0.16`. On a roadmap,
  nothing. There is no such horizon, and offering one invites data that cannot
  be displayed anywhere else in the product.
- What happens when you drag a card slightly right within `now`? On a
  continuous axis it re-times. On a roadmap it must be a no-op, or the model
  accumulates precision nobody asked for and nobody can see.
- What is the order of two cards in the same bucket? On a continuous axis the
  number decides. On a roadmap the bucket is the whole statement, and inventing
  a tiebreak invents a ranking the user never expressed.

So the frame accepts both kinds of "when" as first-class:

```ts
type Position =
  | { kind: 'continuous'; at: number }   // a fraction of the axis
  | { kind: 'bucket'; key: string }      // a named band
```

`buildModel` resolves either into one axis fraction, so everything downstream —
packing, frames, collisions, the tension curve — sees a single number and has a
single code path. The *branching* happens once, at the edge, where the meaning
actually differs. The alternative, branching deep in the layout, is how a
component ends up with two half-tested modes.

**If you are tempted to collapse `Position` into a number, this is the note
saying no.** The continuous case is not the general case. It is one of two.

## The layout is rank-packed, not distance-scaled

The intuitive layout maps position directly to pixels: an item at `0.34` sits
34% of the way across the bed. It is faithful, and it is unusable at real data
volumes.

Story beats cluster. A drafting board with 79 beats has dense knots around act
turns and long dead stretches between them. Distance-scaled, that becomes
thousands of pixels of empty scroll punctuated by unreadable pileups — the
places with the most to read are exactly the places with the least room.

So columns are **rank-packed**: each takes one fixed slot in position order.
Sixty items are sixty slots, evenly legible, however they cluster.

What that costs, stated plainly: **the gap between two columns no longer means
elapsed distance.** Two adjacent columns might be `0.02` apart or `0.30` apart
and look identical. That is a real loss, and it is the right trade — absolute
order still comes from the underlying position, which is the backend's source
of truth, and the axis bands (acts, quarters, phases) carry the coarse sense of
*where along the whole* you are. The optional tension overlay is plotted in
**axis** coordinates rather than column coordinates precisely so that something
in the view still reflects true distance.

Hiding a lane re-packs what is left, for the same reason: the packing is a
function of what is visible, not of what exists.

## Frames and collisions are separate outputs

Both are "two items at the same position." They mean opposite things.

- Across **different** lanes, sharing a `groupId`: a **frame**. One event
  realized in several lanes — a scene two characters are both in. It is the
  point of a lanes view, and it gets one shared column.
- Within the **same** lane: a **collision**. Two things cannot occupy one
  position in one lane. It is a defect in the data, and the app should say so.

Returning one merged `overlaps` list would force every caller to re-derive the
distinction, and callers that forgot would render a bug as a feature. They are
two functions, `frames()` and `collisions()`, and the component draws them
differently.

## The host owns the data

The component holds no copy of the items. Every gesture — drag, keyboard,
rename — calls back and stops.

This is what makes the same component work for an optimistic local editor and
for a server-authoritative board that rejects a third of the moves it is asked
to make. Neither needs a mode flag. The rejecting host simply does not
re-render, and because the component never moved anything itself, there is no
stale internal position to reconcile.
