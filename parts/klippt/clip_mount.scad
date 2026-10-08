// KLIPPT clip mount — the bottom of a KLIPPT clip, sliced off and given a
// flat top: the counterpart of klippt/base. Fused onto a part, it lets
// that part slide onto a KLIPPT base like a clip does. KLIPPT is by FH
// (printables.com/@bequ3), printables.com/model/424351, CC BY-SA 4.0 —
// NOT MIT, see the README's "Licensing".
//
// Cut at render time from the designer's own "cable clip small smooth"
// STL (cable_clip_small_smooth.stl, unmodified), the way deckmate/outie's
// slim version is cut from Mechanism's Adhesive Puck: everything that
// engages the base is the clip's own — its two lips, the 1mm gap under
// its floor that the base's flange slides into, and the lock (the lips
// close in near one end, onto the base neck's corners). What this file
// adds is only the top: the clip up to its floor's crown plus `plate`,
// and everything above the flange gap filled solid (the hull of that
// slice), so the top is one flat face to fuse onto.
//
// The clip is modelled on its side: profile in XY, sliding along Z.
// Here it is stood up — the lips' faces (the side against the base's
// mount surface) on the bed, the slide direction along Y — so the
// functional face is BOTTOM with "bot" on it, the flat top is TOP with
// "mount", and the part is centred between the lips, where a base's
// centre goes.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>

// Measured once on the clip STL with trimesh, in its own coordinates.
KLIPPT_CLIP_LIPS_MID_X   = 154.62;   // midway between the lips' tips (145.89, 163.35)
KLIPPT_CLIP_UNDERSIDE_Y  = 111.7276; // the lips' faces, the clip's lowest point
KLIPPT_CLIP_MID_Z        = 7.5;      // half its 15mm length
KLIPPT_CLIP_FLOOR_CROWN  = 117.48;   // highest point of the floor's top (it arches)
KLIPPT_CLIP_FILL_FROM    = 116.0;    // above the floor's underside (115.81 at most),
                                     // so the flange gap stays as the clip has it
// Across the slide, the part is trimmed to the clip's width at its lips'
// faces (its outer walls lean out above them, so the cut's width would
// otherwise change with `plate`); the trim only takes the outside of the
// walls, nothing a base touches. 0.02mm inside the lips' outermost
// points (137.584, 168.821): a trim exactly through them leaves
// zero-thickness slivers. tests/test_anchors.py holds the envelope to
// the render.
KLIPPT_CLIP_MOUNT_X = [137.6, 168.8];
KLIPPT_CLIP_MOUNT_LENGTH = 15;

function klippt_clip_mount_height(plate) = KLIPPT_CLIP_FLOOR_CROWN + plate - KLIPPT_CLIP_UNDERSIDE_Y;

module klippt_clip_mount(plate = 1, anchor = BOTTOM, spin = 0, orient = UP) {
    assert(plate >= 0.4, "klippt_clip_mount: plate must be at least 0.4mm");
    h = klippt_clip_mount_height(plate);
    x0 = KLIPPT_CLIP_MOUNT_X[0] - KLIPPT_CLIP_LIPS_MID_X;
    x1 = KLIPPT_CLIP_MOUNT_X[1] - KLIPPT_CLIP_LIPS_MID_X;
    size = [x1 - x0, KLIPPT_CLIP_MOUNT_LENGTH, h];
    // The envelope is off-centre in X (the clip is not symmetric about
    // the lips); the anchors stay on the lips' midline, where a base's
    // centre sits.
    shift = (x0 + x1) / 2;
    anchors = [
        named_anchor("mount", [-shift, 0, h / 2], UP, 0),
        named_anchor("bot", [-shift, 0, -h / 2], DOWN, 0),
    ];
    attachable(anchor, spin, orient, size = size, anchors = anchors) {
        // render(): the two pieces overlap and share the top face, which
        // OpenSCAD's preview (the README gallery, the GUI) draws as
        // z-fighting unless they are merged first.
        translate([-shift, 0, -h / 2]) render(convexity = 6) union() {
            // The clip's own bottom, up to the cut ...
            intersection() {
                klippt_clip_stood_up();
                klippt_clip_slab(0, h);
            }
            // ... and above its flange gap, filled solid.
            hull()
                intersection() {
                    klippt_clip_stood_up();
                    klippt_clip_slab(KLIPPT_CLIP_FILL_FROM - KLIPPT_CLIP_UNDERSIDE_Y, h);
                }
        }
        children();
    }
}

// The clip in this part's frame: lips' faces on z = 0, centred between
// the lips in X and along its length in Y. Clip (X, Y, Z) ->
// (X - mid, mid_z - Z, Y - underside): a proper rotation (no mirror).
module klippt_clip_stood_up() {
    multmatrix([[1, 0, 0, -KLIPPT_CLIP_LIPS_MID_X],
                [0, 0, -1, KLIPPT_CLIP_MID_Z],
                [0, 1, 0, -KLIPPT_CLIP_UNDERSIDE_Y],
                [0, 0, 0, 1]])
        import("cable_clip_small_smooth.stl", convexity = 6);
}

// Everything between z0 and z1, within the trimmed width.
module klippt_clip_slab(z0, z1) {
    translate([KLIPPT_CLIP_MOUNT_X[0] - KLIPPT_CLIP_LIPS_MID_X, -20, z0])
        cube([KLIPPT_CLIP_MOUNT_X[1] - KLIPPT_CLIP_MOUNT_X[0], 40, z1 - z0]);
}
