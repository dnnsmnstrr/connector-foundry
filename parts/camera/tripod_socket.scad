// Tripod socket: a boss with a tripod screw's female thread, so a part
// fused onto it screws onto a tripod, a light stand or a camera rig.
// Functional face is BOTTOM, the thread's mouth; "mount" is on TOP, the
// boss's top, where the part goes. "bot" is the mouth. Prints as it
// stands, mouth on the bed (the thread's first turns are beveled, so
// they bridge).
//
// size picks the thread: "1/4" (1/4"-20 UNC, cameras and small gear) or
// "3/8" (3/8"-16 UNC, tripod heads and heavier gear). style "thread"
// prints the thread, BOSL2's threaded_rod() as a mask, opened up by
// FIT_CLEARANCE across (BOSL2's $slop, which it adds four times over);
// style "nut" is a pocket a real hex nut presses into instead, with the
// screw's clearance hole through, for a load a printed thread will not
// take.
//
// The thread runs `depth` deep (ISO 1222 lets a 1/4" tripod screw stand
// up to 5.5mm proud; more is room to spare), with the boss closed above
// it.
include <../../vendor/BOSL2/std.scad>
include <../../vendor/BOSL2/threading.scad>
include <../../lib/slots.scad>
include <../../lib/camera.scad>

module tripod_socket(size = "1/4", style = "thread", diameter = 20, depth = 8, top = 2,
                     anchor = BOTTOM, spin = 0, orient = UP) {
    assert(style == "thread" || style == "nut", "style must be \"thread\" or \"nut\"");
    th = tripod_thread(size);
    nut_d = th[2] / cos(30);
    assert(diameter >= (style == "nut" ? nut_d : th[0]) + 4, "diameter leaves too thin a wall");
    assert(style == "thread" || depth >= th[3] + 1, "depth must take the nut");
    box = [diameter, diameter, depth + top];

    attachable(anchor, spin, orient, size = box,
               anchors = [mount_anchor(box.z / 2), named_anchor("bot", [0, 0, -box.z / 2], DOWN, 0)]) {
        translate([0, 0, -box.z / 2]) difference() {
            cylinder(d = diameter, h = box.z, $fn = 64);
            if (style == "thread")
                translate([0, 0, -0.01])
                    threaded_rod(d = th[0], pitch = th[1], l = depth + 0.01, internal = true,
                                 bevel1 = "reverse", bevel2 = false, anchor = BOTTOM,
                                 $slop = FIT_CLEARANCE / 4, $fn = 48);
            else {
                // The nut, sunk from the mouth, its points on ±y as BOSL2's
                // nut() has them; the screw runs on past it to the depth.
                translate([0, 0, -0.01]) rotate(30)
                    cylinder(d = nut_d + 2 * FIT_CLEARANCE, h = th[3] + FIT_CLEARANCE + 0.01, $fn = 6);
                translate([0, 0, -0.01]) cylinder(d = th[0] + 2 * FIT_CLEARANCE, h = depth + 0.01, $fn = 32);
            }
        }
        children();
    }
}
