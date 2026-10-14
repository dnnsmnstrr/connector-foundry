// A DeckMate Innie's socket, as a cutter: the Holes tab's "DeckMate"
// hole (web/src/lib/screwHoles.js). Cut into a part, the part takes a
// DeckMate Outie (parts/deckmate/outie.scad) the way an Innie does —
// deckmate/innie fused onto a face, done in place instead, with no 2mm
// plate standing proud of it.
//
// DeckMate is Mechanism's (getmechanism.com/pages/digital-files),
// CC BY-NC 4.0 — NOT MIT, see the README's "Licensing"; a part cut with
// this is an adaptation of their Innie.
//
// The cutter is the Innie's own negative, from its STL (parts/deckmate/
// innie.stl, unmodified): its socket, everything between the two
// C-shaped walls that hang under its plate, from the socket's face down
// to the plate. So the dovetail lips, the undercut behind them and the
// shape of the walls' ends are all the Innie's. Its plate is not cut —
// the floor of the socket is the part's own material where the plate's
// underside was — and neither are the two relief slots through the plate
// above the undercuts or the logo in its underside: an Outie pushed in
// and slid to seat never reaches above the plate's underside (checked
// against the meshes: references.yaml's deckmate/outie-in-socket).
//
// Two places an Outie reaches past the Innie's outline, which on an
// Innie are open air but in a part are material: the gaps between the
// walls' ends, at each side, where the ends of the Outie's rail stand
// out to 17.65mm from the centre (and 0.4mm more with its play side to
// side). So each gap is cut on out past the outline, DM_SOCKET_GAP_W
// wide — inside the walls' ends, which are 14.4mm apart at their
// closest; the 0.2mm left either side fills their chamfers.
//
// The cut's sides are the Innie's outline brought in by DM_SOCKET_INSET,
// so they fall inside its walls (2.3mm thick, at least 1.3mm out from
// the cavity everywhere) rather than on their faces, which are drafted
// and chamfered at the bottom: cut to the outline itself, a thin moat
// would run round the outside of the walls.
//
// Frame: the surface at z = 0 where the Innie's socket face was, the
// material below; the origin at the Innie's centre; +Y the way an Outie
// slides to seat — its own centre pushed straight in at the origin (or
// up to 1mm toward -Y, 0.5mm toward +Y of it), then along +Y until it
// stops 2mm on, its hook under a lip so it can't be pulled straight out.
// The cut reaches `overshoot` above the surface.
include <constants.scad>

// The Innie's plate: 2mm thick at the top of its bounding box, its
// underside the socket's floor.
DM_INNIE_PLATE_T = 2;
DM_SOCKET_DEPTH  = DM_INNIE_SIZE.z - DM_INNIE_PLATE_T;   // 3.25
DM_SOCKET_INSET  = 1.3;
// The side gaps' cut: from inside the walls' ends out past the outline.
DM_SOCKET_GAP_W  = 14;
DM_SOCKET_GAP_X  = [15.5, DM_INNIE_SIZE.x / 2 + 1];

module deckmate_socket(overshoot = 1) {
    difference() {
        union() {
            translate([0, 0, -DM_SOCKET_DEPTH])
                linear_extrude(height = DM_SOCKET_DEPTH + overshoot)
                    offset(delta = -DM_SOCKET_INSET)
                        deckmate_innie_outline();
            for (side = [-1, 1])
                translate([side > 0 ? DM_SOCKET_GAP_X[0] : -DM_SOCKET_GAP_X[1], -DM_SOCKET_GAP_W / 2, -DM_SOCKET_DEPTH])
                    cube([DM_SOCKET_GAP_X[1] - DM_SOCKET_GAP_X[0], DM_SOCKET_GAP_W, DM_SOCKET_DEPTH + overshoot]);
        }
        // The plate's top face (the cut's floor) touches the cut's bottom
        // face from below without overlapping it; the walls are what this
        // takes away.
        deckmate_innie_in_hole_frame();
    }
}

// The Innie's outline seen from above: a rounded square. The hull, not
// the projection itself — the relief slots through the plate line up
// with the lips under them, so the projection has two slot-shaped holes,
// which the inset would open up into the walls.
module deckmate_innie_outline() {
    hull() projection() deckmate_innie_in_hole_frame();
}

// The Innie in the hole's frame: centred, turned over about X (its
// socket opening up, +Y the way an Outie seats: toward the side its
// hook goes under), its socket face at z = 0.
module deckmate_innie_in_hole_frame() {
    translate([0, 0, -DM_INNIE_SIZE.z / 2])
        rotate([180, 0, 0])
            translate(-DM_INNIE_CENTER)
                import("../parts/deckmate/innie.stl", convexity = 4);
}
