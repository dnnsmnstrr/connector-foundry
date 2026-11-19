// Basics bolt: a head on a male thread, in any of the threads the
// catalogue's systems use (lib/threads.scad): openGrid's snap thread, a
// Multiboard tile's big and small threads, GOEWS's M14 x 2, and the two
// tripod screws. Functional face is BOTTOM, the thread's tip; "mount" is
// on TOP, the head's face (the thread's top end with no head), so a knob,
// a hook or a plate fused onto it on the Bench screws in with it. "bot"
// is the tip.
//
// `length` is the thread under the head: what the bolt clamps plus how
// far it reaches into the hole. The head's underside is flat, so it
// seats on whatever it clamps.
//
// The head is sized from the thread, `overhang` beyond its crests all
// round, so one number suits a Ø6 thread and a Ø22 one:
//   "hex"      a hexagon, `overhang` to its flats (the flats on ±Y), its
//              top corners chamfered at 30° as a machined bolt's are;
//   "knurled"  round, fluted to grip, for turning by hand;
//   "round"    plain, with a small chamfer;
//   "none"     no head: a stud, the thread alone, cut off flat at the
//              top to fuse onto another part, or a grub screw with
//              `slot`. head_h and overhang are ignored.
// `slot` cuts a straight slot across the head's face, along X, for a
// coin or a flat screwdriver; with no head, across the thread's top end.
//
// It renders thread down, the pose the slot convention asks for. Print
// it turned over, head on the bed: no supports, and the thread's layers
// stack on the head (see the catalogue's print_note).
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../lib/threads.scad>

BOLT_HEADS = ["hex", "knurled", "round", "none"];
// A multiple of 4, so the head has a vertex on each axis and its
// bounding box is its diameter exactly.
BOLT_HEAD_FN = 96;

// The head's outline swept round the axis, with its top edge chamfered:
// `c_r` in, `c_h` down. The hex head is this, cut to a hexagon.
module _bolt_head_turned(r, h, c_r, c_h) {
    rotate_extrude($fn = BOLT_HEAD_FN)
        polygon([[0, 0], [r, 0], [r, h - c_h], [r - c_r, h], [0, h]]);
}

// The head alone, its underside on z = 0. `head_d` is across the flats
// of a hex head, the diameter of the others.
module _bolt_head(head, head_d, head_h, slot) {
    difference() {
        if (head == "hex") {
            corner_r = head_d / 2 / cos(30);
            // Chamfered from the corners in to the flats' circle, at 30°
            // from the face; never more than half the head's height, so
            // the corners stay whole below it and the box stays true.
            c_r = corner_r - head_d / 2;
            c_h = min(c_r * tan(30), head_h / 2);
            intersection() {
                // Flats on ±Y: a vertex at 0°.
                cylinder(d = 2 * corner_r, h = head_h, $fn = 6);
                _bolt_head_turned(corner_r, head_h, c_h / tan(30), c_h);
            }
        } else {
            c = min(0.6, head_h / 2, head_d / 8);
            _bolt_head_turned(head_d / 2, head_h, c, c);
        }
        if (head == "knurled") {
            // One flute for about every 4 mm round the rim, a multiple
            // of 4 with a ridge on each axis (so the box is still the
            // diameter), each a Ø2.4 groove 0.8 mm deep.
            n = max(8, quantup(round(PI * head_d / 4), 4));
            for (i = [0 : n - 1])
                rotate((i + 0.5) * 360 / n) translate([head_d / 2 + 0.4, 0, -0.01])
                    cylinder(r = min(1.2, PI * head_d / n / 4 + 0.2), h = head_h + 0.02, $fn = 16);
        }
        if (slot) {
            // An eighth of the head across, from a small screwdriver's
            // blade (1.2) to a coin's edge (2.5); half the head deep at
            // most, which leaves the hex head's corners whole underneath.
            w = constrain(head_d / 8, 1.2, 2.5);
            deep = min(head_h / 2, 2.5);
            translate([-head_d, -w / 2, head_h - deep]) cube([2 * head_d, w, deep + 0.01]);
        }
    }
}

module basics_bolt(thread = "opengrid", length = 10, head = "hex", head_h = 4, overhang = 3, slot = false,
                   clearance = 0, anchor = BOTTOM, spin = 0, orient = UP) {
    assert(in_list(head, BOLT_HEADS), str("head must be one of ", BOLT_HEADS));
    assert(length >= 1, "length must be at least 1");
    assert(head_h >= 1, "head_h must be at least 1");
    assert(overhang >= 0, "overhang must not be negative");
    assert(clearance >= -0.5 && clearance <= 1, "clearance must be between -0.5 and 1");

    // From the thread as it is cut, so the head is never narrower than
    // it, whatever the clearance.
    thread_d = male_thread_d(thread, clearance);
    head_d = thread_d + 2 * overhang;
    size = head == "none" ? [thread_d, thread_d, length]
         : [head == "hex" ? head_d / cos(30) : head_d, head_d, length + head_h];

    attachable(anchor, spin, orient, size = size,
               anchors = [mount_anchor(size.z / 2), named_anchor("bot", [0, 0, -size.z / 2], DOWN, 0)]) {
        translate([0, 0, -size.z / 2]) {
            if (head == "none") {
                difference() {
                    male_thread(thread, length, clearance);
                    if (slot) {
                        // The head's slot, sized from the thread instead,
                        // and never more than half the stud deep.
                        w = constrain(thread_d / 8, 1.2, 2.5);
                        deep = min(length / 2, 2.5);
                        translate([-thread_d, -w / 2, length - deep]) cube([2 * thread_d, w, deep + 0.01]);
                    }
                }
            } else {
                // A hundredth into the head, so the two are one solid.
                male_thread(thread, length + 0.01, clearance);
                translate([0, 0, length]) _bolt_head(head, head_d, head_h, slot);
            }
        }
        children();
    }
}
