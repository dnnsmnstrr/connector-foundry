// Gridfinity bin base. Functional face is BOTTOM (also the print
// orientation); mates through the "mount" anchor on TOP.
//
// Profile numbers adapted from gridfinity-rebuilt-openscad
// (kennetek, MIT License) — see lib/constants.scad for the sourced
// values and lib/joints.scad for how this composes with other parts.
include <BOSL2/std.scad>
include <../../lib/constants.scad>
include <../../lib/slots.scad>
include <../../lib/util.scad>

module gf_base(gx = 1, gy = 1, bridge = GF_BRIDGE, magnets = false, screws = false,
               anchor = BOTTOM, spin = 0, orient = UP) {

    top_size   = [gx * GF_PITCH - GF_GAP, gy * GF_PITCH - GF_GAP];
    cell_inner = GF_TOP_SIZE.x - 2 * GF_PROFILE_R; // innermost (bottom) cross-section per cell
    total_h    = GF_PROFILE_H + bridge;
    size       = [top_size.x, top_size.y, total_h];

    anchors = [mount_anchor(size.z / 2)];

    attachable(anchor, spin, orient, size = size, anchors = anchors) {
        translate([0, 0, -total_h / 2])
        difference() {
            union() {
                // One profiled base per grid cell.
                for (i = [0 : gx - 1])
                    for (j = [0 : gy - 1])
                        translate([(i - (gx - 1) / 2) * GF_PITCH, (j - (gy - 1) / 2) * GF_PITCH, 0])
                            offset_sweep(
                                rect([cell_inner, cell_inner], rounding = GF_BOTTOM_RADIUS),
                                bottom = os_profile(points = GF_BASE_PROFILE),
                                height = GF_PROFILE_H,
                                anchor = "base"
                            );

                // Bridge slab ties every cell together into one part.
                translate([0, 0, GF_PROFILE_H])
                    linear_extrude(bridge)
                        rect(top_size, rounding = GF_TOP_RADIUS);
            }

            if (magnets || screws)
                for (i = [0 : gx - 1])
                    for (j = [0 : gy - 1]) {
                        cx = (i - (gx - 1) / 2) * GF_PITCH;
                        cy = (j - (gy - 1) / 2) * GF_PITCH;
                        corner_pattern([GF_TOP_SIZE.x, GF_TOP_SIZE.y], GF_HOLE_FROM_SIDE)
                            translate([cx, cy, 0]) {
                                if (magnets) pocket(GF_MAGNET_R + FIT_CLEARANCE, GF_MAGNET_D);
                                if (screws)  through_hole(GF_SCREW_R + FIT_CLEARANCE, total_h + 1);
                            }
                    }
        }
        children();
    }
}
