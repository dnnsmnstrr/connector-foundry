# Accuracy

How `references.yaml` and `make verify` check a part against a reference model of the same standard. Back to the [README](../README.md).

A wrong part still renders, is watertight, and has a stable bounding box. Golden dimensions catch
a part *moving*; only a comparison against someone else's model of the same standard catches it
being *wrong*. `references.yaml` declares those comparisons; `make refs` fetches the sources
(submodules, or pinned commits into gitignored `refs/`) and `make verify` runs them:

- **shape** — our part and the reference through the same OpenSCAD binary: volume, symmetric
  surface distance, and cross-section IoU at declared heights. IoU is what catches a mating profile
  that is the right size and the wrong shape.
- **fit** — our part and its real counterpart in the assembled pose, intersected: interference
  volume and smallest clearance.

`confidence: exact` is a claim, and a test fails if a part makes it without a check behind it. The
harness earned its keep: before it existed, the Gridfinity foot was 5.9 mm undersized, the GoPro
buckles could not interleave at all, the openGrid cells were invented geometry (IoU 0.23), and
three 2020 fittings drove tens to hundreds of mm³ into the rail.

A `kind: file` reference takes a STEP or STL you supply (manufacturer CAD behind a login) — drop
it in `refs/manual/` and uncomment the example in `references.yaml`.
