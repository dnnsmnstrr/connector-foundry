// MOD-GRID bit holder: a clip for driver bits that snaps into a MOD-GRID
// grid (parts/modgrid/grid.scad) on the 2x1 pin. MOD-GRID is by 3dedc
// (TinyToolShop), MakerWorld model 2811701, CC BY-NC-SA 4.0 — NOT MIT,
// see the README's "Licensing"; lib/modgrid.scad has the pin.
//
// Three of the designer's holders, rebuilt from their v4 STLs — the
// profiles below are those files' cross-sections, measured, made
// symmetric where the originals are a tenth or less off it:
//
// - "4mm": three 4mm hex bits (precision screwdriver bits). The sockets
//   are 4.2mm across their flats, the middle one 4.3; each is held by
//   I-shaped posts with a T on top, the outer two open on the holder's
//   sides, the middle one between the two Ts.
// - "6mm": two 1/4" (6.35mm) hex bits, the common "6mm" bit, in 6.6mm
//   sockets either side of a centre post, each open on its outer side.
//   The designer's file is two one-bit halves side by side; here it is
//   one body.
// - "leatherman": three of Leatherman's flat double-ended bits, each in
//   a C: a post, and a hook over the bit with a 0.75mm slit between its
//   tip and the next post, so the hook springs; the last C is open on
//   the holder's side.
//
// The hex sockets are not regular hexagons: corner to corner they are
// 3% short of their width across the flats (4.2 x 4.705, 4.3 x 4.806,
// 6.6 x 7.405), in every one of the designer's files. A 1/4" bit is
// 6.35 across its flats and 7.33 across its corners, so the socket is
// 0.25mm wide of the flats and 0.07 of the corners.
//
// The bits run along the holder (Y), the way they lie on the grid, and
// are pushed in from an end. A holder spans `rows` rows of the grid,
// 8mm each and a pin in each; the designer's are one row.
//
// Orientation: functional face BOTTOM — the pin, pointing down; "mount"
// on TOP, the holder's top. Print it the way the designer does, on its
// side with the profile flat on the bed (an end face down), so the pin's
// legs and the clips are drawn out in each layer.
include <../../vendor/BOSL2/std.scad>
include <../../lib/slots.scad>
include <../../lib/modgrid.scad>

MODGRID_BITS = ["4mm", "6mm", "leatherman"];

// [body height, peg depth] per bit; every body is the pin's width or
// 0.2mm inside it either side (the hex holders are 14.6mm across).
function modgrid_bit_spec(bit) =
    bit == "4mm" ? [7.05, 4.9] : bit == "6mm" ? [9.8, 4.9] : [9.9, 5];

// A hex socket with vertical flats, centred on (cx, cy): `a` half its
// width across the flats, `c` from its centre to its top and bottom
// corners. Its six corners, from the bottom one, clockwise.
function modgrid_hex(cx, cy, a, c) =
    [[cx, cy - c], [cx - a, cy - c / 2], [cx - a, cy + c / 2],
     [cx, cy + c], [cx + a, cy + c / 2], [cx + a, cy - c / 2]];

// Where a hex's lower (or, with up, upper) slanted edge on the side of
// `x` crosses x: for a socket cut by the holder's side or a T's tip.
function modgrid_hex_edge_y(cx, cy, a, c, x, up = false) =
    let (d = abs(x - cx) * (c / 2) / a)
    up ? cy + c - d : cy - c + d;

// Each profile is a closed path of [x, y, r]: the corner, and how much
// it is rounded (0: sharp). The body stands on y = 0 (the pin's root),
// centred on x = 0, and runs counter-clockwise; a socket open to an
// edge is a clockwise detour in it.

// 4mm: sockets at -5.2, 0 and 5.2, 3.75 up. The outer ones' outer flats
// are the holder's sides (the designer's right socket stands 0.1mm
// further out than the left); the Ts' tips are 1mm apart.
function modgrid_profile_4mm() =
    let (w = 7.3, h = 7.05, r = 1.05, cy = 3.75,
         ao = 2.1, co = 2.3525, am = 2.1525, cm = 2.403, tip = 0.5,
         ty = modgrid_hex_edge_y(0, cy, am, cm, tip, up = true),
         right = modgrid_hex(5.2, cy, ao, co), mid = modgrid_hex(0, cy, am, cm),
         left = modgrid_hex(-5.2, cy, ao, co))
    [[-w, 0, 0], [w, 0, 0],
     [w, cy - co / 2, 0], each [for (i = [0 : 3]) [right[i].x, right[i].y, 0]], [w, cy + co / 2, 0],
     [w, h, r], [tip, h, r], [tip, ty, 0],
     [mid[4].x, mid[4].y, 0], [mid[5].x, mid[5].y, 0], [mid[0].x, mid[0].y, 0],
     [mid[1].x, mid[1].y, 0], [mid[2].x, mid[2].y, 0],
     [-tip, ty, 0], [-tip, h, r], [-w, h, r],
     [-w, cy + co / 2, 0], [left[3].x, left[3].y, 0], [left[4].x, left[4].y, 0],
     [left[5].x, left[5].y, 0], [left[0].x, left[0].y, 0], [-w, cy - co / 2, 0]];

// 6mm: sockets at -4.25 and 4.25, 5 up, their inner flats 1.9mm apart
// (the centre post); the outer flats would be 0.25mm outside the sides.
function modgrid_profile_6mm() =
    let (w = 7.3, h = 9.8, r = 1.05, cx = 4.25, cy = 5, a = 3.302, c = 3.7025,
         lo = modgrid_hex_edge_y(cx, cy, a, c, w), hi = modgrid_hex_edge_y(cx, cy, a, c, w, up = true),
         right = modgrid_hex(cx, cy, a, c), left = modgrid_hex(-cx, cy, a, c))
    [[-w, 0, 0], [w, 0, 0],
     [w, lo, 0], each [for (i = [0 : 3]) [right[i].x, right[i].y, 0]], [w, hi, 0],
     [w, h, r], [-w, h, r],
     [-w, hi, 0], [left[3].x, left[3].y, 0], [left[4].x, left[4].y, 0],
     [left[5].x, left[5].y, 0], [left[0].x, left[0].y, 0], [-w, lo, 0]];

// Leatherman: three slots 5.25mm apart, from a 1.53mm post at the left
// edge. A slot is 3.72mm from its post to the next; its floor and its
// hook's underside are 30° chevrons with a 0.28mm flat, 1.644 and
// 9.053mm up, 1.3mm out from the post; the hook's tip is 2.97mm out,
// which puts the last one on the holder's right side.
function modgrid_profile_leatherman() =
    let (w = 7.5, h = 9.9, r = 0.9, post = 1.53, pitch = 5.25, gap = 3.72, hook = 2.97,
         floor_y = 1.644, roof_y = 9.053, apex = 1.3, flat = 0.28, t = tan(30),
         slot = function(i) let (x = -w + post + i * pitch) [
             // In from the next post (or, for the last slot, the side),
             // down to the floor, up the post, under the hook, out.
             each (i == 2
                 ? [[w, floor_y + (hook - apex - flat) * t, 0]]
                 : [[x + gap, h, r], [x + gap, floor_y + (gap - apex - flat) * t, 0]]),
             [x + apex + flat, floor_y, 0], [x + apex, floor_y, 0], [x, floor_y + apex * t, 0],
             [x, roof_y - apex * t, 0], [x + apex, roof_y, 0], [x + apex + flat, roof_y, 0],
             [x + hook, roof_y - (hook - apex - flat) * t, 0], [x + hook, h, r],
         ])
    [[-w, 0, 0], [w, 0, 0], each slot(2), each slot(1), each slot(0), [-w, h, r]];

function modgrid_bit_profile(bit) =
    bit == "4mm" ? modgrid_profile_4mm() : bit == "6mm" ? modgrid_profile_6mm() : modgrid_profile_leatherman();

module modgrid_bit_holder(bit = "4mm", rows = 1, anchor = BOTTOM, spin = 0, orient = UP) {
    assert(in_list(bit, MODGRID_BITS), "bit must be \"4mm\", \"6mm\" or \"leatherman\"");
    assert(rows >= 1 && rows == round(rows), "rows must be a whole number, at least 1");
    spec = modgrid_bit_spec(bit);
    length = rows * MODGRID_PITCH;
    size = [MODGRID_PIN_W, length, MODGRID_PIN_LEN + spec[0]];
    profile = modgrid_bit_profile(bit);

    attachable(anchor, spin, orient, size = size, anchors = [mount_anchor(size.z / 2)]) {
        // Profile frame to part frame, as for the connector: a quarter
        // turn about X takes the pin down and the bits along -y. render()
        // merges body and pin for the preview, as there.
        translate([0, length / 2, (MODGRID_PIN_LEN - spec[0]) / 2]) rotate([90, 0, 0]) render(convexity = 4) {
            linear_extrude(length)
                polygon(round_corners([for (p = profile) [p.x, p.y]], radius = [for (p = profile) p[2]],
                                      $fa = detail_fa(6), $fs = detail_fs(0.2)));
            modgrid_pin(spec[1], rows, overlap = 0.01, $fa = detail_fa(6), $fs = detail_fs(0.2));
        }
        children();
    }
}
