# Joints

How `lib/joints.scad` mates two parts through their mount slots, and what each joint exports. Back to the [README](../README.md).

`lib/joints.scad` mates two parts through their mount slots in five ways:

- **fused** — plain `attach()`, one body.
- **bolted** — a flange on each side on a shared 4-hole pattern (insert bore one side, clearance
  hole the other).
- **snap** — barbed pegs one side, matching holes the other.
- **pin** — a 4.8 mm bored flange on each side and a real BitBeam pin as a third body.
- **screwed** — for a part that already carries Mechanism's DeckMate three-hole pattern
  (`deckmate/outie`, `deckmate/universal`): at most one generated flange with heat-set insert bores
  at that spacing, on whichever side has no holes. Lets a DeckMate rail print in its own best
  orientation and be fastened on.

Every non-fused joint exposes one `part=` tag per printable body, so each exports to its own STL.
