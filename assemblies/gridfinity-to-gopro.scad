// Gridfinity-to-GoPro adapter: a gridfinity bin base bolted to a GoPro
// male buckle, so a GoPro accessory plugs straight into a gridfinity
// grid. Two bolted flanges (lib/joints.scad) form the joint — print both
// halves separately (part = "a" / "b") and bolt them together with
// heat-set inserts (side a) + M3 bolts through side b.
//
// Chaining past an already-attached flange uses its implicit BOTTOM
// anchor, not "mount": attach() reorients a flange's "mount" anchor onto
// the face that ends up touching its parent, so the far (exposed) face
// is the flange's other, unnamed-but-implicit face — see bolted_flange_a
// in lib/joints.scad.
include <../vendor/BOSL2/std.scad>
include <../lib/joints.scad>
include <../parts/gridfinity/base.scad>
include <../parts/gopro/male.scad>

part = "all"; // ["all", "a", "b"]

module _half_a() { gf_base() attach("mount", "mount") bolted_flange_a(); }
module _half_b() { gopro_male() attach("mount", "mount") bolted_flange_b(); }

if (part == "a") _half_a();
if (part == "b") _half_b();
if (part == "all")
    gf_base()
        attach("mount", "mount")
            bolted_flange_a()
                attach(BOTTOM, "mount")
                    bolted_flange_b()
                        attach(BOTTOM, "mount")
                            gopro_male();
