// Every thread the catalogue's systems use, as a male thread: one name
// per thread, one module that builds it. Used by parts/basics/bolt.scad,
// so one bolt screws into whichever system's hole it is told to.
//
// Nothing is defined here that another library already defines: each
// thread is that system's own module or numbers, sized as the male half
// of the fit its library documents.
//   "opengrid"          openGrid's snap thread, Ø16 at 3 mm pitch
//                       (lib/ogthread.scad): a threaded openGrid snap, or
//                       the openGrid thread the Holes tab cuts. The male
//                       is nominal; the hole carries the 0.5 clearance.
//   "multiboard-big"    a Multiboard tile's big hole, Ø22.5 at 2.5 mm
//                       (lib/multiboard.scad), MB_THREAD_CLEARANCE
//                       narrower across, as Multiboard's own bolts are.
//   "multiboard-small"  a tile's small hole, Ø7.03 at 3 mm, likewise.
//                       Underware's "Threaded Snap Connector" holes
//                       (lib/underware.scad) are cut for the same male
//                       thread: Ø6.75, 3 mm pitch.
//   "goews"             a GOEWS tile's thread, M14 x 2 (lib/goews.scad):
//                       the bolt that locks a hanger plate. The tile's
//                       hole is opened up to Ø14.45; the male is an M14
//                       bolt's, GOEWS_BOLT_D across.
//   "tripod-1/4"        the camera screw, 1/4"-20 UNC, and
//   "tripod-3/8"        the tripod-head one, 3/8"-16 (lib/camera.scad),
//                       FIT_CLEARANCE narrower across: what they screw
//                       into is metal cut to size, or
//                       parts/camera/tripod_socket.scad, which is opened
//                       up by the same amount again.
include <../vendor/BOSL2/std.scad>
include <../vendor/BOSL2/threading.scad>
include <constants.scad>
include <ogthread.scad>
include <multiboard.scad>
include <goews.scad>
include <camera.scad>

// The names, in the order the catalogue's `options` lists them.
MALE_THREADS = ["opengrid", "multiboard-big", "multiboard-small", "goews", "tripod-1/4", "tripod-3/8"];

// The GOEWS bolt's thread: M14 at the middle of ISO 965's 6g tolerance
// for a bolt (13.68 to 13.96 across the crests), not its 14.0 nominal.
// A hanger plate's notch is a Ø14 arc round the thread's axis
// (GOEWS_NOTCH_R), which a 14.0 thread would rub all the way round;
// this clears it by 0.1 mm, and the tile's thread by 0.33 mm a side.
GOEWS_BOLT_D = 13.8;

// [crest diameter of the male thread before any extra clearance, pitch]
function male_thread_spec(thread) =
    assert(in_list(thread, MALE_THREADS), str("thread must be one of ", MALE_THREADS))
    thread == "opengrid" ? [OG_THREAD_D, OG_THREAD_PITCH]
    : thread == "multiboard-big" ? [MB_BIG[0] - MB_THREAD_CLEARANCE, MB_BIG[2]]
    : thread == "multiboard-small" ? [MB_SMALL[0] - MB_THREAD_CLEARANCE, MB_SMALL[2]]
    : thread == "goews" ? [GOEWS_BOLT_D, GOEWS_THREAD_PITCH]
    : [tripod_thread(thread == "tripod-1/4" ? "1/4" : "3/8")[0] - FIT_CLEARANCE,
       tripod_thread(thread == "tripod-1/4" ? "1/4" : "3/8")[1]];

// Across the male thread's crests: the spec's diameter, `clearance`
// narrower.
function male_thread_d(thread, clearance = 0) = male_thread_spec(thread)[0] - clearance;

// The male thread as a solid, its axis z: the tip, the end that goes
// into the hole first, on z = 0 and the head's end at `length`, cut off
// flat there with the thread at full depth, to stand under a head.
// `clearance` takes that much more off its diameter (a negative one adds
// it), on top of the fit described above.
//
// Each thread starts as its own library starts it, so the tip finds the
// hole: openGrid's blunt start, the Multiboard threads' half-pitch
// lead-in, and for the ISO and UTS threads a beveled tip under a blunt
// start (BOSL2's default for a rod's end).
module male_thread(thread, length, clearance = 0) {
    spec = male_thread_spec(thread);
    if (thread == "opengrid")
        // og_thread() runs from its head on z = 0 out to its tip: turned
        // over about Y, as lib/openconnect.scad's oc_screw() turns it.
        translate([0, 0, length]) rotate([0, 180, 0]) og_thread(length, -clearance);
    else if (thread == "multiboard-big" || thread == "multiboard-small")
        mb_thread(thread == "multiboard-big" ? "big" : "small", length, -MB_THREAD_CLEARANCE - clearance);
    else
        threaded_rod(d = spec[0] - clearance, pitch = spec[1], l = length, bevel1 = true, bevel2 = false,
                     blunt_start1 = true, blunt_start2 = false, anchor = BOTTOM, $fn = 48);
}
