// Upstream's GOEWS hanger_plate() under a name of this repo's, for
// parts/goews/hanger.scad: use this file, don't include it
// (lib/goews.scad says why; lib/goews_tile.scad why it is a file alone).
use <../vendor/goews-rebuilt/hanger.scad>

// hanger_plate(), with the parameters the part sets; the rest (the round
// corners, the side gaps) keep upstream's defaults.
module goews_upstream_hanger_plate(variant, plate, bolt_notch, units, tolerance, extend)
    hanger_plate(variant = variant, plate_thickness = plate, bolt_notch = bolt_notch,
                 hanger_units = units, hanger_tolerance = tolerance, extend_bottom = extend);
