// Shared body for the GoPro-standard prong buckle. A hinge block (holds
// the pivot bolt hole) with `n_prongs` blades hanging below it, spaced on
// GP_PRONG_PITCH so consecutive blades leave GP_SLOT_W gaps between them
// — that gap IS the slot the mating part's prongs slide into, so male
// (2 prongs) and female (3 prongs) share this one generator.
//
// Functional face (the GoPro-standard interface) is BOTTOM: prong tips
// point down, hinge block and "mount" anchor are on top.
include <../../vendor/BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/util.scad>

function _gopro_prong_y(n) = [for (i = [0 : n - 1]) (i - (n - 1) / 2) * GP_PRONG_PITCH];
function _gopro_stack_y(n) = (n - 1) * GP_PRONG_PITCH + GP_PRONG_T;

module gopro_body(n_prongs, prong_len = GP_PRONG_LEN, hinge_t = GP_HINGE_T,
                   anchor = BOTTOM, spin = 0, orient = UP) {
    stack_y = _gopro_stack_y(n_prongs);
    total_h = hinge_t + prong_len;
    size    = [GP_ARM_WIDTH, stack_y, total_h];

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        translate([0, 0, -total_h / 2])
        difference() {
            union() {
                translate([0, 0, prong_len])
                    cuboid([GP_ARM_WIDTH, stack_y, hinge_t], rounding = 2, edges = "Z", anchor = BOTTOM);

                for (y = _gopro_prong_y(n_prongs))
                    translate([0, y, 0])
                        cuboid([GP_ARM_WIDTH, GP_PRONG_T, prong_len], rounding = 1, edges = [BOTTOM + LEFT, BOTTOM + RIGHT], anchor = BOTTOM);
            }
            translate([0, 0, prong_len + hinge_t / 2])
                xcyl(r = GP_BOLT_R + FIT_CLEARANCE, h = GP_ARM_WIDTH + 1);
        }
        children();
    }
}
