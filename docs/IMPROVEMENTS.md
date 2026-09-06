# Future improvements

## Complete OpenSCAD assembly exports

The Bench's `.scad` download references imported meshes as `imports/<id>.stl`
but does not download those files. It also relies on the repository's relative
SCAD includes and does not capture the active printer overrides.

The existing `.bench.json` config export already embeds imported meshes and can
restore the project in the browser. Keep that flow; a future OpenSCAD export
should package the generated source, imported meshes, printer overrides, and
required dependency versions/instructions so the same assembly can be rendered
locally. Check that its dimensions match the browser export with non-default
printer settings and an imported part.

Deferred deliberately; no change to `.scad` export behavior in this review.
