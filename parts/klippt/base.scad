// KLIPPT base — the mount a KLIPPT locking cable clip slides onto.
// KLIPPT is by FH (printables.com/@bequ3), published at
// printables.com/model/424351 under CC BY-SA 4.0 — NOT MIT, see the
// README's "Licensing". The designer's own models, imported unmodified and given this
// repo's slot convention so a base can be fused onto anything here, the
// way the DeckMate parts are.
//
// The base is a regular octagon in two steps: a 20mm (across flats)
// flange 1mm thick, on an 18mm neck 2mm tall. A clip's two lips slide
// under the flange from the side, past the neck, and grip it; the neck's
// flat face sits flush with the clip's own back, against whatever the
// base is on. references.yaml's klippt/clip-on-base checks a real clip
// on it.
//
// Two of KLIPPT's files: the plain base (their klippt-base STEP,
// tessellated at 0.01mm chord / 0.05rad, finer than any printer
// resolves) and, with `screw`, their screw base STL — the same octagon
// with a countersunk hole through it, the countersink opening on the
// flange side, so the screw head sits under the clip.
//
// Orientation: functional face BOTTOM — the flange the clip slides
// onto, which is also the print orientation (flange on the bed). The
// neck's flat face is TOP with "mount" at its center: what the base is
// stuck, screwed or fused onto. "bot" is the flange's face. The STEP is
// modelled the other way up (neck down), so it is turned over here; the
// screw STL is already this way up.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>

// The meshes' bounding boxes in their own coordinates, measured once
// with trimesh and restated because OpenSCAD cannot measure an import()
// (attachable() needs the size up front). tests/test_anchors.py renders
// every face anchor against the real geometry, so these cannot drift
// from the files without failing.
KLIPPT_BASE_SIZE        = [20, 20, 3];
KLIPPT_PLAIN_CENTER     = [0, 0, -1.5];                                  // base.stl
KLIPPT_SCREW_CENTER     = [116.4762191772461, 55.57627868652344, 0];     // screw_base.stl

module klippt_base(screw = false, anchor = BOTTOM, spin = 0, orient = UP) {
    size = KLIPPT_BASE_SIZE;
    anchors = [
        mount_anchor(size.z / 2),
        named_anchor("bot", [0, 0, -size.z / 2], DOWN, 0),
    ];
    attachable(anchor, spin, orient, size = size, anchors = anchors) {
        // Imports resolve against this file, so this works from the CLI's
        // stub, a Bench assembly and the browser alike (the web bundle
        // ships the .stl files next to this one).
        if (screw)
            translate(-KLIPPT_SCREW_CENTER) import("screw_base.stl", convexity = 4);
        else
            // Neck down in the STEP: a half turn about X puts the flange
            // at the bottom.
            rotate([180, 0, 0]) translate(-KLIPPT_PLAIN_CENTER) import("base.stl", convexity = 4);
        children();
    }
}
