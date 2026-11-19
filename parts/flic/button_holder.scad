// Flic 2 button holder: a round cup the button snaps into face out, its
// lip catching the button's rounded front edge (see lib/flic.scad). The
// mouth is BOTTOM, the functional face; "mount" is on TOP, the back of the
// cup, where it is fused to a board, a wall plate or another part. "bot"
// is the mouth's centre.
//
// Three slits and a notch split the wall into four fingers, so the lip
// springs open by `lip` mm a side as the button goes in: 0.5mm is about 1%
// strain in a 2mm PLA finger 9mm long, well short of what PLA takes. The
// notch is also where a fingernail gets under the button's edge to lever it
// out. With lip 0 the cup is a plain pocket the button's own adhesive pad
// or a press fit holds, and the slits go.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/flic.scad>

// Wide enough for a fingertip's nail, narrow enough to leave the finger
// either side of it most of its grip.
FLIC_BUTTON_NOTCH = 8;

module flic_button_holder(wall = 2, floor = 2, lip = 0.5, notch = true,
                          anchor = BOTTOM, spin = 0, orient = UP) {
    pocket_d = FLIC_BUTTON_D + 2 * FIT_CLEARANCE;
    depth = flic_button_depth(lip);
    // A multiple of 4 sides puts a vertex on each axis, so the mesh is
    // exactly its nominal size across in X and Y.
    pocket = circle(d = pocket_d, $fn = 128);
    outer_d = pocket_d + 2 * wall;
    h = depth + floor;

    attachable(anchor, spin, orient, size = [outer_d, outer_d, h],
               anchors = [mount_anchor(h / 2), named_anchor("bot", [0, 0, -h / 2], DOWN, 0)]) {
        translate([0, 0, -h / 2]) flic_cup(pocket, depth, wall, floor, lip) {
            if (lip > 0)
                for (a = [90, 180, 270])
                    flic_radial_cut(a, FLIC_SLIT_W, depth, pocket_d / 2 - lip - 0.5);
            if (notch)
                flic_radial_cut(0, FLIC_BUTTON_NOTCH, depth, pocket_d / 2 - lip - 0.5);
        }
        children();
    }
}
