import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import DecimalInput from "./DecimalInput.jsx";
import { useCommands } from "../hooks/useCommands.js";
import { useGridSnap } from "../hooks/useGridSnap.js";
import { edgeOnToView, facingViewer, rayLinePoint, rayPlanePoint, screenAxisDelta } from "../lib/dragMath.js";
import { dialSegments, dialStep, planeAngle, snapTurn, unwrapAngle } from "../lib/rotateDial.js";
import { parseDecimal } from "../lib/decimalInput.js";
import { clusterFace } from "../lib/faceCluster.js";
import { hasCommandModifier, ignoresShortcut } from "../lib/isEditableTarget.js";
import { builtin } from "../lib/commandCatalog.js";
import { GRID_SNAP_OPTIONS, setGridSnap } from "../lib/uiPrefs.js";
import {
  CONTAIN_MARGIN,
  VIEW_PRESETS,
  boxCenter,
  clipPlanes,
  dollyOutDistance,
  dollyToFit,
  fitView,
  grabOffset,
  handlesGrew,
  inReach,
  modelRadius,
  presetViewFitting,
  refitMode,
} from "../lib/viewerCamera.js";

const MARKER_COLOR = 0x2ecc71;
const MARKER_HOVER_COLOR = 0xffd23f;
const MODEL_COLOR = 0x5b8ff9;
const BACKGROUND_COLOR = 0x1a1b1e;
const DEFAULT_MARKER_RADIUS = 2;
const HIGHLIGHT_COLOR = 0xffd23f;
const HIGHLIGHT_PAD_MM = 0.3;
// The resize ghost: a light tint of the focus-ring accent, which reads
// over the blue model, the dark background and the grid alike (the
// Bench's yellow selection box is a different thing and keeps its colour).
const GHOST_COLOR = 0xa9b9ff;
// The rotate dial: white, so it reads apart from the ghost it turns.
const DIAL_COLOR = 0xffffff;
// Pointer travel between pointerdown and click beyond which it was an
// orbit drag, not a click — and, on a handle, a resize, not a click that
// opens the size box. A mouse holds still to within a few pixels; a
// fingertip (or a pen) wanders further on a tap — Chrome counts a touch
// as a tap up to about 15 px, Android's slop is 8 dp — and with the mouse
// figure a tap that drifted 6 px committed a 1-3 mm resize instead of
// opening the size box. See slopFor().
const CLICK_SLOP_PX = 5;
const TOUCH_SLOP_PX = 10;
// A tap that misses every slot marker picks the nearest one within this
// many pixels of it, when nothing of the model stands in front. Markers
// are sized in millimetres, so a 2 mm one is 5-17 px across on a phone
// for ordinary parts — a fingertip's target is about 44 px.
const TOUCH_PICK_PX = 22;
// On a touch device the framebuffer is bounded by area as well as by the
// pixel ratio: an iPad Pro's viewer at ratio 2 is 4-5 million MSAA pixels
// per frame of a flick, which an older tablet's GPU drops frames on. The
// ratio is lowered (never below 1) until a frame fits the budget; phones,
// whose viewers are under it at ratio 2, are unaffected.
const MAX_TOUCH_FRAMEBUFFER_PX = 2.2e6;
// How far a handle's grab target sits from the point it stands for: the
// footprint ones out past the edge, the height one above the top face on
// a short stem. It keeps the targets off the model body and off the slot
// markers that sit at face centres (a plate's side anchors are 2 mm above
// its bottom edge, its "mount" marker exactly at the top centre).
const HANDLE_OFFSET_PX = 12;
const TOP_HANDLE_OFFSET_PX = 18;
// A grab target counts as in reach (see keepHandlesInReach) with its whole
// hit area this far inside the viewer and clear of the chrome over it.
const REACH_GAP_PX = 4;
// How far inside the viewer's edges the size box, the drag label and a
// handle's readout are kept.
const VIEW_MARGIN_PX = 6;
// The drag label sits this far above (or below) its point: clear of the
// dragged handle's grab target, which is drawn 12-18 px out from it.
const LABEL_GAP_PX = 26;
// The readout's gap from its handle's hit area.
const READOUT_GAP_PX = 2;
// The drag label, and a handle's readout, keep this far from a shown
// handle's centre: half the hovered square, so they never hide one.
const LABEL_HANDLE_CLEAR_PX = 7;
// Hovering or focusing a handle this long shows its size (TinkerCAD shows
// the measurements on hover).
const HANDLE_READOUT_MS = 300;
// The screen-space fallback reads pointer travel along a projected piece
// of the axis this long; any length works, it only sets the scale.
const FALLBACK_SEGMENT_MM = 10;
// The scene objects that are helpers rather than the model: what the
// "Helpers" toggle hides (see below).
const HELPER_OBJECTS = ["grid", "markers", "guides", "highlight", "ghost", "dial"];
// The fallback for a viewer without handles: one array for every render,
// so the effects that follow `handles` don't run on each of them.
/** @type {any[]} */
const NO_HANDLES = [];
// The keys a running handle drag lets through: they change what the drag
// does (Alt: from the centre in Holes; Shift: off the grid), so they
// re-run the preview instead.
const MODIFIER_KEYS = new Set(["Shift", "Alt", "Control", "Meta"]);

// stlBuffer or geometry: one model source. `geometry` (a THREE.BufferGeometry,
// e.g. straight from meshValidate.js) skips a wasted serialize/reparse
// round-trip when the caller already has one parsed — the STL-import
// slot-placement view uses this. A geometry the caller passed in stays
// the caller's to dispose; one parsed here from stlBuffer is disposed
// here when replaced or on unmount.
//
// markers: optional [{ id, x, y, z, radius?, color?, shape?, normal? }]
// — small clickable objects overlaid on the model, in the model's own
// mm coordinates (existing slots to attach something to; the Holes
// tab's holes and snap points). A sphere by default, in the green
// slot colour; `shape: "ring"` draws a flat ring lying on the surface
// whose outward `normal` is given (a hole's outline). Hover turns any
// of them yellow. `hitTest: false` makes a marker display-only: the
// raycaster never sees it, so it neither takes clicks nor stops the
// hover reports underneath it (the Holes tab's marker that follows the
// pointer along a guide line would otherwise sit under the pointer and
// freeze the hover).
// onMarkerClick(id, { shiftKey, altKey, metaKey, ctrlKey }): called when
// a marker is clicked, with the click's modifier keys (the Holes tab's
// Shift-click adds a hole to its selection).
//
// labels: optional [{ id, point: [x,y,z], text }] — short texts pinned
// to points in the scene (the Holes tab's measurements), re-projected
// every frame like the overlay and hidden behind the camera.
//
// guides: optional [{ a: [x,y,z], b: [x,y,z], color?, dashed? }] — thin
// line segments drawn over the model (the Holes tab's center and quarter
// lines on the hovered face). Not clickable; lifted a hair off the
// surface the caller puts them on by passing points already offset.
//
// placingMode + onSurfacePick([x,y,z], [nx,ny,nz]): when placingMode is
// true, clicking anywhere on the model itself (not a marker) raycasts
// against its real triangles, then walks out from the hit triangle
// across every connected, coplanar neighbor (faceCluster.js) to find
// the whole flat surface under the cursor — so the reported point is
// that surface's center, not wherever the ray happened to land, and
// the normal is its mating direction. A curved/faceted region has no
// such flat neighbor, so this degrades to the hit triangle's own
// centroid — never worse than a raw click point.
//
// onSurfaceHit(hit) + onSurfaceHover(hit | null): the raw alternative
// to onSurfacePick for a caller that does its own snapping (the Holes
// tab, lib/snapCandidates.js). With onSurfaceHit set, a placing-mode
// click reports the hit as it is — { point, normal (the triangle's
// own), faceIndex, altKey, shiftKey, mmPerPx (the millimetres one screen
// pixel spans at the hit, to size a snap reach to a fingertip), touch
// (a finger or a pen rather than a mouse) } — instead of a clustered face
// center, and onSurfaceHover gets the same record as the pointer moves
// over the model (null once it leaves it; not called while a marker is
// under the pointer, so snap markers don't vanish on approach).
//
// onModelClick([x,y,z] | null): a plain click (no marker under the
// cursor, not placing) reports where on the model it landed, in model
// mm, or null for a click on empty space — the Bench turns that into
// "select the part here" / "deselect". A drag that happens to end over
// the canvas is not a click (see CLICK_SLOP_PX), so orbiting never
// deselects or opens a marker.
//
// highlightBox: optional { min:[x,y,z], max:[x,y,z] } — an axis-aligned
// outline drawn around it (the selected Bench node).
//
// overlayAnchor + children: `children` are rendered in a DOM layer over
// the canvas, pinned to the screen projection of `overlayAnchor` (model
// mm) and re-pinned every frame so they follow the camera, moved only as
// far as it takes to keep them inside the viewer; with no
// anchor they dock at the bottom center of the viewer instead. The layer
// hides while a handle is dragged or its size box is open.
//
// Resize handles (TinkerCAD's small squares on the selected object). The
// viewer draws and drives them; what a handle means is the mode's
// business, through these callbacks — Library and the Bench resize a
// part's parameters (lib/resize.js builds their handles), Holes a hole.
// - handles: optional ViewerHandle[] (typedef below): each a DOM slider
//   over the canvas, re-projected every frame, its grab target drawn a
//   few px outward from `point` along `dir` (above it on a stem for kind
//   "top", on it for "move"). `constraint` is what a drag moves along: a
//   line through `point` (`dir`) or a plane through it (`normal`). A
//   handle whose line points within 15° of the view, or whose plane is
//   within 15° of edge-on, is hidden (lib/dragMath.js), and so is one
//   behind the camera. `label`, `value`, `valueText`, `min` and `max`
//   are its slider semantics (aria-label, -valuenow, -valuetext,
//   -valuemin, -valuemax); `valueText` is also the readout shown after
//   a moment's hover or focus. `tabbable` makes it a Tab stop (one per
//   axis for a symmetric resize: the mirror does the same job; never a
//   corner, which drives two values); the rest are pointer-only and
//   hidden from assistive tech. `editable` opens the inline size box on
//   a click or Enter, prefilled with `editValue` (mm) and labelled
//   `editLabel`. A click on a handle (a press that never became a drag)
//   depends on its kind. An editable one opens its size box. A "move"
//   one is the click on the canvas under it, with its modifier keys: it
//   covers the very spot it moves (a hole's centre), and that spot's
//   click (select the hole, Shift to take it out of the selection) must
//   still work. Any other (a corner) does nothing: those are drawn off
//   the body, where the canvas's click would drop the selection (the
//   Bench) or drill a second hole beside the first (Holes) on a grab
//   that only didn't move. A press while the size box is open only
//   closes the box, on any handle as on the canvas.
//   `span` (optional) is the side of the body the handle
//   stands on, from `point` to `point + span` (lib/resize.js gives a
//   footprint handle on a box's bottom edge the box's height): the grab
//   target is drawn clear of all of it, so looking down on a tall part
//   it sits outside the top rim, not on it. Keep the ids stable across
//   renders: a focused handle keeps its focus only if its element
//   survives, and the camera keeps handles in reach only across a list
//   that shares ids with the last one (below).
// - handleMode: "symmetric" (default; Library and the Bench, whose parts
//   grow on both sides) fades a footprint handle on the far side of the
//   box to 35% and lets clicks through it while its mirror image on the
//   near side is visible — the near one does the same job and is the one
//   the user means. "anchored" (Holes, where each edge resizes from the
//   opposite one) keeps every handle live.
// - onHandleStart(id): a drag begins (snapshot what it starts from).
// - onHandlePreview(id, point, modifiers) → { segments, text?, textPoint?,
//   handlePoints? } | null: the pointer moved (at most once a frame);
//   `point` is where the handle's `point` has been dragged to along its
//   constraint, in model mm — moved by the pointer's travel from the
//   press (the grab target sits off the point, and a press lands anywhere
//   on it), so a press that hasn't moved is the handle's own point. The
//   viewer draws `segments` as the ghost outline, `text` in a label at
//   `textPoint`, and moves each handle named in `handlePoints` (the
//   dragged one, and the mirror that moves with it) there; every other
//   handle hides until the drag ends. null shows nothing.
// - onHandleCommit(id, point, modifiers): the pointer came up after a
//   real drag; `point` is the one the last preview was given, so the
//   commit is exactly what the ghost showed.
// - onHandleEnd(id, committed): every drag ends here, after the commit
//   or without one (Esc, a lost pointer, the handle going away) — for a
//   mode that hides something of its own while a drag runs.
// - onHandleStep(id, steps, modifiers): ±1 from the arrow keys on a
//   focused handle (Up/Right grow, Down/Left shrink); Shift's ×10 is the
//   mode's to apply where it makes sense.
// - onHandleSet(id, mm): a size typed into the inline box (Enter, or
//   focus leaving it while the window has focus). Esc, a box left empty
//   or one closed still showing what it opened with sets nothing.
// - ghost: optional { segments, text?, textPoint? } — an outline the mode
//   keeps up while no drag runs: the size a commit asked for, until its
//   render lands ("rendering…").
// - rotation: optional { center, axis, radius, base } — the selected
//   object can turn about `axis` (a unit vector) through `center` (model
//   mm), and is at `base` degrees now. With it, a handle pressed with Alt
//   (Option on a Mac) held turns the object instead of resizing it, as in
//   TinkerCAD and the slicers: a dial of `radius` mm is drawn in the plane
//   through `center` square to the axis, every handle hides, and the
//   angle the pointer turns round the centre (right-handed about the
//   axis) snaps to the dial's 15° ticks with the pointer on the dial, to
//   whole degrees pulled out past it (lib/rotateDial.js) — the snap is to
//   absolute angles, `base` included. Held Alt shows a turning cursor
//   over the handles. A press with Alt that never travels does nothing
//   (no size box). Esc cancels, as for a resize.
// - onRotatePreview(degrees) → { segments, text?, textPoint? } | null:
//   the turn so far, snapped; the viewer draws what comes back as the
//   ghost (the object's outline turned), with the dial.
// - onRotateCommit(degrees): the pointer came up after a turn other
//   than 0; `degrees` is what the last preview was given.
//
// The toolbar in the viewer's top-right corner: the caller's `toolbar`
// (its Undo and Redo), a Grid select when `gridControl` is set (the
// uiPrefs.js grid that drags and keyboard steps snap to), Fit, the View
// menu (Home, Top, Front, Right) and Helpers.
// - Fit, or F with the pointer anywhere but a text field: look at
//   `fitBox` (the Bench's selection) or else the whole model, from the
//   direction the camera looks now, near enough to fill the view.
// - fitKey: what the model is of (Library: the part id). A new model with
//   the same key keeps the camera where the user put it, backing out
//   only if it no longer fits; a new key, or the first model, gets the
//   Home framing. Without a fitKey the camera re-fits whenever the
//   model's size or place moves by more than 2%, as it always did.
// - Handles that grow (new `handles` sharing an id with the last ones,
//   reaching past them: a resize's predicted box, before its render
//   lands) back the camera out, never in, just far enough that each
//   handle that could be grabbed before still can — shown, wholly inside
//   the viewer, clear of the toolbar and of anything else the viewer's
//   parent lays over it — and so can the keyboard-focused one, with the
//   box their points span inside the margin a landed model gets (so the
//   render, when it lands, moves the camera no further). A mode that
//   switches between subjects with the same ids (two holes) and wants
//   no camera move should give each subject its own ids.
// - The wheel zooms toward the pointer (OrbitControls' zoomToCursor).
//
// The "Helpers" button (or H, with the pointer anywhere but a text
// field) hides everything that isn't the model — the grid, markers,
// guides, labels, the highlight box, the handles and their ghost and the
// `children` overlay — to see the part as it will print. While they are
// hidden the viewer takes no clicks or hover (nothing to aim at, and a
// click shouldn't drill a hole or pick a part nobody can see), and a
// hover in progress is reported as left. Each viewer starts with them
// shown.
//
// Frames are rendered on demand, not on a 60fps loop: a frame is drawn
// when the camera moves (OrbitControls' "change", which it also fires
// on each damping step, so a drag settles smoothly), when the model or
// markers change, on hover highlight, and on resize. A viewer showing a
// still scene costs nothing — this is the one always-visible WebGL
// canvas in the app, so it was the app's whole idle GPU/battery cost.
/**
 * @typedef {number[]} Vec3 [x, y, z], model mm (callers build them with map(), so not a tuple)
 * @typedef {{ min: Vec3, max: Vec3 }} Box
 * @typedef {{ point: Vec3, normal: Vec3, faceIndex: number, altKey: boolean, shiftKey: boolean,
 *   mmPerPx: number, touch: boolean }} SurfaceHit
 * @typedef {{ shiftKey: boolean, altKey: boolean, metaKey: boolean, ctrlKey: boolean }} ClickModifiers
 * @typedef {object} StlMarker
 * @property {string} id
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} [radius]
 * @property {number} [color]
 * @property {"sphere" | "ring"} [shape]
 * @property {Vec3} [normal]
 * @property {boolean} [hitTest]
 *
 * @typedef {object} ViewerHandle
 * @property {string} id stable across renders
 * @property {string} kind "edge" | "corner" | "top" | "move"
 * @property {Vec3} point what the handle stands for: the face, edge or centre point its constraint passes through
 * @property {Vec3} dir outward unit vector (where the grab target is drawn, and which side faces the camera)
 * @property {{ type: string, dir?: Vec3, normal?: Vec3 }} constraint `{ type: "line", dir }` or `{ type: "plane", normal }`
 * @property {string} label aria-label, e.g. "Width (gx)"
 * @property {number} value aria-valuenow
 * @property {string} valueText aria-valuetext and the hover readout, e.g. "84 mm · gx 2"
 * @property {number} [min]
 * @property {number} [max]
 * @property {boolean} tabbable
 * @property {boolean} editable a click (or Enter) opens the inline size box
 * @property {number} [editValue] the size box's prefill, mm
 * @property {string} [editLabel] the size box's label, e.g. "Width (mm)"
 * @property {Vec3} [span] the side of the body it stands on runs from `point` to `point + span`; the grab target is drawn clear of it
 *
 * @typedef {{ segments: Vec3[][], text?: string, textPoint?: Vec3 }} ViewerGhost
 * @typedef {ViewerGhost & { handlePoints?: Record<string, Vec3> }} HandlePreview
 * @typedef {{ center: Vec3, axis: Vec3, radius: number, base?: number }} ViewerRotation
 *
 * @param {object} props
 * @param {ArrayBuffer} [props.stlBuffer]
 * @param {THREE.BufferGeometry} [props.geometry]
 * @param {StlMarker[]} [props.markers]
 * @param {{ a: Vec3, b: Vec3, color?: number, dashed?: boolean }[]} [props.guides]
 * @param {{ id: string, point: Vec3, text: string }[]} [props.labels]
 * @param {(id: string, modifiers: ClickModifiers) => void} [props.onMarkerClick]
 * @param {boolean} [props.placingMode]
 * @param {(point: Vec3, normal: Vec3) => void} [props.onSurfacePick]
 * @param {(hit: SurfaceHit) => void} [props.onSurfaceHit]
 * @param {(hit: SurfaceHit | null) => void} [props.onSurfaceHover]
 * @param {(point: Vec3 | null) => void} [props.onModelClick]
 * @param {Box | null} [props.highlightBox]
 * @param {Vec3 | null} [props.overlayAnchor]
 * @param {import("react").ReactNode} [props.children]
 * @param {ViewerHandle[]} [props.handles]
 * @param {"symmetric" | "anchored"} [props.handleMode]
 * @param {(id: string) => void} [props.onHandleStart]
 * @param {(id: string, point: Vec3, modifiers: ClickModifiers) => HandlePreview | null} [props.onHandlePreview]
 * @param {(id: string, point: Vec3, modifiers: ClickModifiers) => void} [props.onHandleCommit]
 * @param {(id: string, committed: boolean) => void} [props.onHandleEnd]
 * @param {(id: string, steps: number, modifiers: ClickModifiers) => void} [props.onHandleStep]
 * @param {(id: string, mm: number) => void} [props.onHandleSet]
 * @param {ViewerGhost | null} [props.ghost]
 * @param {ViewerRotation | null} [props.rotation]
 * @param {(degrees: number) => ViewerGhost | null} [props.onRotatePreview]
 * @param {(degrees: number) => void} [props.onRotateCommit]
 * @param {import("react").ReactNode} [props.toolbar]
 * @param {boolean} [props.gridControl]
 * @param {Box | null} [props.fitBox]
 * @param {string} [props.fitKey]
 */
export default function StlViewer({
  stlBuffer,
  geometry,
  markers,
  guides,
  labels,
  onMarkerClick,
  placingMode,
  onSurfacePick,
  onSurfaceHit,
  onSurfaceHover,
  onModelClick,
  highlightBox,
  overlayAnchor,
  children,
  handles,
  handleMode = "symmetric",
  onHandleStart,
  onHandlePreview,
  onHandleCommit,
  onHandleEnd,
  onHandleStep,
  onHandleSet,
  ghost,
  rotation,
  onRotatePreview,
  onRotateCommit,
  toolbar,
  gridControl = false,
  fitBox,
  fitKey,
}) {
  const rootRef = useRef(null);
  const mountRef = useRef(null);
  const overlayRef = useRef(null);
  // Label elements by id, and the labels themselves, for the per-frame
  // projection (see positionLabels in the mount effect).
  const labelElements = useRef(new Map());
  const labelsRef = useRef([]);
  const sceneRef = useRef(null);
  const callbacksRef = useRef(null);
  const overlayAnchorRef = useRef(null);
  // What the overlay was last positioned for (see the overlay effect).
  const overlayPinnedRef = useRef(null);
  // What the camera was last fitted for (see the geometry effect and
  // viewerCamera.js's refitMode()), and the model's box (for Fit and the
  // View menu).
  const fitRef = useRef(null);
  const modelBoxRef = useRef(null);
  // What the marker, highlight and guide helpers in the scene were last
  // built from (see markersKey / highlightKey / guidesKey): every
  // assembly edit hands the viewer a fresh `markers` array and a fresh
  // `highlightBox` object, and the Holes tab a fresh `guides` array,
  // usually describing exactly what is already there — rebuilding the
  // spheres (a material each, up to a few dozen) for those would be
  // wasted work. Keyed on the scene too: a remount starts empty.
  const builtMarkersRef = useRef(null);
  const builtHighlightRef = useRef(null);
  const builtGuidesRef = useRef(null);
  // A browser with WebGL disabled (or a GPU process that just died)
  // throws from the WebGLRenderer constructor. Without this, that throw
  // escapes the effect and React unmounts the whole app to a blank page
  // — so show a message in the viewer's place instead.
  const [webglError, setWebglError] = useState(null);
  const [helpersHidden, setHelpersHidden] = useState(false);
  // For the event handlers in the mount effect, which outlive renders.
  const helpersHiddenRef = useRef(false);
  // Whether the last hover report was a hit, so "left the model" is
  // reported once — on leaving it, or on the helpers being hidden.
  const hoveringRef = useRef(false);

  // Handles: the latest props for the per-frame projection and the drag
  // (written during render, like callbacksRef's callers expect: a drag
  // that outlives a render reads the newest callbacks), the elements by
  // id, the open size box, and the handle whose readout is showing.
  const handleList = handles ?? NO_HANDLES;
  const handlesRef = useRef(handleList);
  handlesRef.current = handleList;
  const handlePropsRef = useRef(null);
  handlePropsRef.current = {
    handleMode,
    onHandleStart,
    onHandlePreview,
    onHandleCommit,
    onHandleEnd,
    onHandleStep,
    onHandleSet,
    rotation: rotation ?? null,
    onRotatePreview,
    onRotateCommit,
  };
  const ghostRef = useRef(ghost ?? null);
  ghostRef.current = ghost ?? null;
  const fitKeyRef = useRef(fitKey);
  fitKeyRef.current = fitKey;
  const fitBoxRef = useRef(fitBox ?? null);
  fitBoxRef.current = fitBox ?? null;
  const handleElements = useRef(new Map());
  const [editingId, setEditingId] = useState(null);
  const editingIdRef = useRef(null);
  editingIdRef.current = editingId;
  const editorElementRef = useRef(null);
  const [readoutId, setReadoutId] = useState(null);
  const readoutIdRef = useRef(null);
  readoutIdRef.current = readoutId;
  const readoutTimer = useRef(null);
  // The handle list the layout effect last placed: the "before" of a
  // resize that grows them (see keepHandlesInReach).
  const laidOutRef = useRef(NO_HANDLES);
  const dragLabelRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    const root = rootRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND_COLOR);
    // A handle drag in progress (see `drags` below). Refs only, so a
    // pointer move re-renders nothing in React: the handle as it was at
    // pointerdown — its constraint passes through that point for the whole
    // gesture, as the mode's start snapshot does — the pointer, and the
    // last preview.
    /** @type {{ current: any }} */
    const dragRef = { current: null };

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    camera.position.set(80, -80, 80);
    camera.up.set(0, 0, 1);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (err) {
      setWebglError(err);
      return;
    }
    // Capped at 2: a 3x phone screen would shade 2.25 times the pixels of
    // a 2x one for a difference nobody sees on a part preview. On a touch
    // device also by area (MAX_TOUCH_FRAMEBUFFER_PX), so it depends on
    // the mount's size and is re-applied from resize().
    const coarsePointer = Boolean(window.matchMedia?.("(pointer: coarse)").matches);
    const applyPixelRatio = () => {
      let ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (coarsePointer) {
        const area = Math.max(1, mount.clientWidth * mount.clientHeight);
        ratio = Math.min(ratio, Math.max(1, Math.sqrt(MAX_TOUCH_FRAMEBUFFER_PX / area)));
      }
      renderer.setPixelRatio(ratio);
    };
    applyPixelRatio();
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(1, -1, 2);
    scene.add(dirLight);
    const grid = new THREE.GridHelper(120, 12, 0x444444, 0x2a2b2e);
    grid.name = "grid";
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    // The resize ghost: one LineSegments whose buffer is rewritten in
    // place each preview (and replaced only when it has to grow), drawn
    // over the model (no depth test) so the size it shows is never hidden
    // inside the part it outlines.
    const ghostMaterial = new THREE.LineBasicMaterial({
      color: GHOST_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    });
    const ghostLines = new THREE.LineSegments(new THREE.BufferGeometry(), ghostMaterial);
    ghostLines.name = "ghost";
    ghostLines.renderOrder = 10;
    ghostLines.frustumCulled = false;
    ghostLines.geometry.setDrawRange(0, 0);
    scene.add(ghostLines);
    // Where the ghost's label is pinned (model mm), or null for none.
    let ghostLabelPoint = null;
    // The rotate dial, drawn the same way, over the ghost.
    const dialMaterial = new THREE.LineBasicMaterial({
      color: DIAL_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.85,
    });
    const dialLines = new THREE.LineSegments(new THREE.BufferGeometry(), dialMaterial);
    dialLines.name = "dial";
    dialLines.renderOrder = 11;
    dialLines.frustumCulled = false;
    dialLines.geometry.setDrawRange(0, 0);
    scene.add(dialLines);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    // TinkerCAD (and most CAD) zooms toward what is under the pointer.
    controls.zoomToCursor = true;

    let frameId = null;
    const renderFrame = () => {
      frameId = null;
      // With damping on, update() keeps nudging the camera for a few
      // frames after the pointer stops and fires "change" each time it
      // does — which requests the next frame. Once it settles, no
      // change, no frame.
      controls.update();
      renderer.render(scene, camera);
      positionDom();
    };
    // Everything DOM that follows the scene, re-projected after each
    // frame — and directly (positionDom) when new handle elements mount,
    // so they never show a frame at the corner.
    const positionDom = () => {
      positionOverlay();
      positionLabels();
      positionHandles();
      positionGhostLabel();
      positionEditor();
    };
    const projected = new THREE.Vector3();
    // Mount px for a model point, or null behind the camera (NDC z > 1:
    // hidden rather than mirrored onto the screen).
    const toScreen = (p) => {
      projected.set(p[0], p[1], p[2]).project(camera);
      if (projected.z > 1) return null;
      return [((projected.x + 1) / 2) * mount.clientWidth, ((1 - projected.y) / 2) * mount.clientHeight];
    };
    // Same projection for each label.
    const positionLabels = () => {
      for (const label of labelsRef.current) {
        const el = labelElements.current.get(label.id);
        if (!el) continue;
        const at = toScreen(label.point);
        if (!at) {
          el.style.visibility = "hidden";
          continue;
        }
        el.style.visibility = "";
        el.style.transform = `translate(${at[0].toFixed(1)}px, ${at[1].toFixed(1)}px) translate(-50%, -50%)`;
      }
    };
    // Pin the overlay layer to the anchor's screen position, moved as
    // little as it takes to keep what it shows inside the viewer, as the
    // readouts and the size box are: an anchor near the viewer's edge
    // would otherwise take the pill there, and its Delete and Deselect,
    // out of sight. What it shows may hang outside the layer's own box
    // (the Holes pill hangs below its anchor by a transform), so it is the
    // children's drawn boxes that are measured.
    const positionOverlay = () => {
      const el = overlayRef.current;
      const anchor = overlayAnchorRef.current;
      if (!el || !anchor) return;
      const at = toScreen(anchor);
      if (!at) {
        el.style.visibility = "hidden";
        return;
      }
      el.style.visibility = "";
      const place = (/** @type {number} */ x, /** @type {number} */ y) => {
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      };
      place(at[0], at[1]);
      const [dx, dy] = overlayShift(el);
      if (dx || dy) place(at[0] + dx, at[1] + dy);
    };
    // How far the overlay has to move for its children's boxes to sit
    // VIEW_MARGIN_PX inside the viewer ([0, 0] when they do, or when it
    // shows nothing — it is hidden during a handle drag); the top left
    // wins when they can't fit.
    const overlayShift = (/** @type {HTMLElement} */ el) => {
      let box = null;
      for (const child of el.children) {
        const r = child.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        box = box
          ? {
              left: Math.min(box.left, r.left),
              top: Math.min(box.top, r.top),
              right: Math.max(box.right, r.right),
              bottom: Math.max(box.bottom, r.bottom),
            }
          : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }
      if (!box) return [0, 0];
      const view = mount.getBoundingClientRect();
      // On a phone the sidebar is a drawer over the foot of the screen
      // (SidebarToggle.jsx): the pill stays above it, with Delete and
      // Deselect, rather than under the sheet.
      const drawer = parseFloat(getComputedStyle(mount).getPropertyValue("--drawer-inset")) || 0;
      const bottom = drawer > 0 ? Math.min(view.bottom, window.innerHeight - drawer) : view.bottom;
      const fit = (lo, hi, min, max) => (lo < min ? min - lo : hi > max ? Math.max(max - hi, min - lo) : 0);
      return [
        fit(box.left, box.right, view.left + VIEW_MARGIN_PX, view.right - VIEW_MARGIN_PX),
        fit(box.top, box.bottom, view.top + VIEW_MARGIN_PX, bottom - VIEW_MARGIN_PX),
      ];
    };

    // Where each handle's grab target was last drawn (mount px) and
    // whether it is fully shown (1) or not (0), for the size box that opens
    // beside it and the drag label that keeps off it.
    const handleScreen = new Map();
    // Where each of `list`'s grab targets goes with the camera where it is
    // now (`at`, the point's projection, plus `offset`; mount px) and
    // whether it shows: "shown", "faded" or "hidden". The per-frame
    // placement below draws it; the reach check further down asks it
    // about camera positions it only tries.
    const layoutHandles = (list) => {
      const drag = dragRef.current;
      // During a drag only the handles the preview moves (the dragged
      // one and its mirror) stay, where the preview put them.
      // A turn hides them all: the dial and the turned outline are what
      // it shows.
      const moved = drag?.active ? (drag.rotate ? {} : (drag.preview?.handlePoints ?? {})) : null;
      const eye = camera.position.toArray();
      const states = [];
      for (const handle of list) {
        const dragged = !!moved && !drag.rotate && (handle.id === drag.id || Object.hasOwn(moved, handle.id));
        const point = (dragged && moved[handle.id]) || handle.point;
        const at = toScreen(point);
        const viewDir = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
        let state = "shown";
        if (!at || (moved && !dragged)) state = "hidden";
        // Edge-on: a drag couldn't read the pointer along it (the same
        // cone dragMath.js's intersections refuse). A running drag keeps
        // its handle whatever the perspective does to it.
        else if (!dragged && edgeOnToView(handle.constraint, viewDir)) state = "hidden";
        let offset = [0, 0];
        if (at && handle.kind !== "move") {
          // The grab target sits out along the handle's direction as the
          // screen shows it (project a short piece of `dir`), clear of the
          // side of the body the handle stands on (`span`).
          const reach = Math.hypot(...viewDir) * 0.02;
          const tip = toScreen([0, 1, 2].map((i) => point[i] + handle.dir[i] * reach));
          const top = handle.span ? toScreen([0, 1, 2].map((i) => point[i] + handle.span[i])) : null;
          const px = handle.kind === "top" ? TOP_HANDLE_OFFSET_PX : HANDLE_OFFSET_PX;
          offset = grabOffset(at, tip, top, px);
        }
        states.push({ handle, at, offset, state, dragged, facing: facingViewer(handle.dir, viewDir) });
      }
      if (handlePropsRef.current.handleMode !== "anchored") {
        // A footprint handle on the far side of the box fades while its
        // mirror on the near side is up: same job, and the near one is
        // the one the user is looking at. Not the keyboard-focused one
        // (the Tab stop of an axis may be the far one): its focus ring and
        // readout are what the keyboard user reads.
        const active = document.activeElement;
        const focused =
          active instanceof HTMLElement && root?.contains(active) ? active.dataset.handleId : undefined;
        for (const s of states) {
          if (s.state !== "shown" || s.dragged || s.facing || s.handle.id === focused) continue;
          if (s.handle.kind !== "edge" && s.handle.kind !== "corner") continue;
          const mirror = states.find(
            (m) =>
              m !== s &&
              m.state === "shown" &&
              m.facing &&
              m.handle.dir.reduce((sum, v, i) => sum + v * s.handle.dir[i], 0) < -0.99,
          );
          if (mirror) s.state = "faded";
        }
      }
      return states;
    };
    const positionHandles = () => {
      handleScreen.clear();
      const list = handlesRef.current;
      // None mounted: no handles, or the helpers are hidden.
      if (!list.length || !handleElements.current.size) return;
      let readout = null;
      for (const { handle, at, offset, state } of layoutHandles(list)) {
        const el = handleElements.current.get(handle.id);
        if (!el) continue;
        el.dataset.state = state;
        if (!at) continue;
        const x = at[0] + offset[0];
        const y = at[1] + offset[1];
        handleScreen.set(handle.id, [x, y, state === "shown" ? 1 : 0]);
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
        // The height handle's stem runs back down to the point it stands for.
        const stem = /** @type {HTMLElement | null} */ (el.querySelector(".viewer-handle-stem"));
        if (stem) {
          stem.style.width = `${Math.hypot(offset[0], offset[1]).toFixed(1)}px`;
          stem.style.transform = `rotate(${Math.atan2(-offset[1], -offset[0]).toFixed(4)}rad)`;
        }
        if (handle.id === readoutIdRef.current) readout = { id: handle.id, el, x, y };
      }
      // Once every handle is placed, so the readout can keep off them.
      if (readout) positionReadout(readout.id, readout.el, readout.x, readout.y);
    };
    // A box of w × h px placed at (x, y) in the mount, moved as little as
    // it takes to stay VIEW_MARGIN_PX inside it.
    const clampInView = (x, y, w, h) => [
      Math.max(VIEW_MARGIN_PX, Math.min(x, mount.clientWidth - w - VIEW_MARGIN_PX)),
      Math.max(VIEW_MARGIN_PX, Math.min(y, mount.clientHeight - h - VIEW_MARGIN_PX)),
    ];
    // A handle's readout sits to its right, or to its left where the right
    // has no room, and inside the viewer either way: the handles near the
    // edge are the ones a grown part pushes there. Where that spot would
    // hide another shown handle, the other side is tried, then straight
    // below and above — each of those slid on past the handles it would
    // hide, as far as the viewer goes (the Holes tab's move handle stands
    // inside a ring of a small hole's rim handles a few pixels round it).
    // It is the handle's child, so it is placed relative to the handle's
    // corner.
    const positionReadout = (id, el, x, y) => {
      const readout = /** @type {HTMLElement | null} */ (el.querySelector(".viewer-handle-readout"));
      if (!readout) return;
      const corner = [x - el.offsetWidth / 2, y - el.offsetHeight / 2];
      const w = readout.offsetWidth;
      const h = readout.offsetHeight;
      const clear = LABEL_HANDLE_CLEAR_PX;
      const right = x + el.offsetWidth / 2 + READOUT_GAP_PX;
      const left = x - el.offsetWidth / 2 - READOUT_GAP_PX - w;
      const beside = right + w > mount.clientWidth - VIEW_MARGIN_PX ? [left, right] : [right, left];
      // The centre of the first other shown handle a spot would hide.
      const hidden = (/** @type {number[]} */ [sx, sy]) =>
        [...handleScreen].find(
          ([other, [hx, hy, shown]]) =>
            other !== id &&
            shown &&
            hx + clear > sx &&
            hx - clear < sx + w &&
            hy + clear > sy &&
            hy - clear < sy + h,
        )?.[1] ?? null;
      // A spot from (sx, sy) that hides no handle — slid on down (slide 1)
      // or up (-1) past each one it would, inside the viewer — or null.
      const clearSpot = (sx, sy, slide) => {
        let spot = clampInView(sx, sy, w, h);
        for (let i = 0; i <= handleScreen.size; i++) {
          const hit = hidden(spot);
          if (!hit) return spot;
          if (!slide) return null;
          const next = clampInView(spot[0], slide > 0 ? hit[1] + clear : hit[1] - clear - h, w, h);
          // Pinned at the viewer's edge: it can go no further.
          if (next[1] === spot[1]) return null;
          spot = next;
        }
        return null;
      };
      const at =
        clearSpot(beside[0], y - h / 2, 0) ??
        clearSpot(beside[1], y - h / 2, 0) ??
        clearSpot(x - w / 2, y + el.offsetHeight / 2 + READOUT_GAP_PX, 1) ??
        clearSpot(x - w / 2, y - el.offsetHeight / 2 - READOUT_GAP_PX - h, -1) ??
        clampInView(beside[0], y - h / 2, w, h);
      readout.style.transform = `translate(${(at[0] - corner[0]).toFixed(1)}px, ${(at[1] - corner[1]).toFixed(1)}px)`;
    };
    // The ghost's label: above its point, clear of the dragged handle's
    // grab target — or below it, where above is off the viewer or covers a
    // handle (the mirror, once a part is narrow) — and inside the viewer
    // either way.
    const positionGhostLabel = () => {
      const el = dragLabelRef.current;
      if (!el) return;
      const at = ghostLabelPoint && el.textContent ? toScreen(ghostLabelPoint) : null;
      if (!at) {
        el.style.visibility = "hidden";
        return;
      }
      el.style.visibility = "";
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const spots = [at[1] - LABEL_GAP_PX - h, at[1] + LABEL_GAP_PX].map((top) => ({
        inside: top >= VIEW_MARGIN_PX && top + h <= mount.clientHeight - VIEW_MARGIN_PX,
        at: clampInView(at[0] - w / 2, top, w, h),
      }));
      const covers = (/** @type {number[]} */ [x, y]) =>
        [...handleScreen.values()].some(
          ([hx, hy, shown]) =>
            shown &&
            hx + LABEL_HANDLE_CLEAR_PX > x &&
            hx - LABEL_HANDLE_CLEAR_PX < x + w &&
            hy + LABEL_HANDLE_CLEAR_PX > y &&
            hy - LABEL_HANDLE_CLEAR_PX < y + h,
        );
      const spot = spots.find((s) => s.inside && !covers(s.at)) ?? spots.find((s) => s.inside) ?? spots[0];
      el.style.transform = `translate(${spot.at[0].toFixed(1)}px, ${spot.at[1].toFixed(1)}px)`;
    };
    // The size box sits beside its handle, kept inside the viewer.
    const positionEditor = () => {
      const el = editorElementRef.current;
      const at = el && handleScreen.get(editingIdRef.current);
      if (!el || !at) return;
      const [x, y] = clampInView(at[0] + 16, at[1] - el.offsetHeight / 2, el.offsetWidth, el.offsetHeight);
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    };
    const requestRender = () => {
      if (frameId === null) frameId = requestAnimationFrame(renderFrame);
    };
    controls.addEventListener("change", requestRender);
    // Mobile browsers drop a WebGL context under memory pressure or when
    // the tab goes to the background; three restores its own GL state
    // when the context comes back but draws nothing, and frames here are
    // on demand, so the canvas stayed blank until the next touch.
    const onContextRestored = () => requestRender();
    renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);
    // The phone's drawer moved over the view: the pill is placed again
    // (see overlayShift), which only happens when a frame is drawn.
    window.addEventListener("sidebar-drawer", requestRender);
    const onVisible = () => {
      if (!document.hidden) requestRender();
    };
    document.addEventListener("visibilitychange", onVisible);

    // The ghost on screen: the running drag's preview, else the mode's
    // pending ghost prop, else nothing.
    // `segments` into one of the LineSegments above, its buffer rewritten
    // in place.
    const writeSegments = (lines, segments) => {
      let attr = /** @type {THREE.BufferAttribute | undefined} */ (lines.geometry.getAttribute("position"));
      const vertices = segments.length * 2;
      if (!attr || attr.count < vertices) {
        // Grow in powers of two; a replaced attribute keeps its GL buffer
        // until its geometry is disposed, so replace the geometry whole.
        let capacity = 32;
        while (capacity < vertices) capacity *= 2;
        lines.geometry.dispose();
        lines.geometry = new THREE.BufferGeometry();
        attr = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
        attr.setUsage(THREE.DynamicDrawUsage);
        lines.geometry.setAttribute("position", attr);
      }
      const array = /** @type {Float32Array} */ (attr.array);
      let i = 0;
      for (const [a, b] of segments) {
        array[i++] = a[0];
        array[i++] = a[1];
        array[i++] = a[2];
        array[i++] = b[0];
        array[i++] = b[1];
        array[i++] = b[2];
      }
      attr.needsUpdate = true;
      lines.geometry.setDrawRange(0, vertices);
    };
    const refreshGhost = () => {
      const drag = dragRef.current;
      // A press that hasn't travelled yet may still be a click: the
      // pending ghost stays until it turns into a drag.
      const shown = drag?.active ? drag.preview : ghostRef.current;
      writeSegments(ghostLines, shown?.segments ?? []);
      writeSegments(dialLines, drag?.active && drag.rotate ? drag.rotate.dial : []);
      const label = dragLabelRef.current;
      if (label) label.textContent = shown?.text ?? "";
      ghostLabelPoint = shown?.text && shown.textPoint ? shown.textPoint : null;
      requestRender();
    };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const setPointerAt = (clientX, clientY) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
    };
    const setPointer = (event) => setPointerAt(event.clientX, event.clientY);
    // Typed for what this file puts under those names (the model mesh,
    // a group of marker meshes); getObjectByName() only knows Object3D.
    const markerGroup = () =>
      /** @type {THREE.Group<THREE.Object3DEventMap> & { children: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] } | undefined} */ (
        scene.getObjectByName("markers")
      );
    const model = () => /** @type {THREE.Mesh | undefined} */ (scene.getObjectByName("model"));

    // The browser fires "click" after an orbit drag too, as long as the
    // pointer went down and came up on the canvas — so remember where it
    // went down and treat anything that travelled further than a few
    // pixels as the drag it was, not a click. A press while a handle's
    // size box is open only closes the box (its blur commits it): in
    // Holes the click would otherwise drill a hole, in the Bench drop
    // the selection the box belongs to.
    let pointerDownAt = null;
    let pointerDownSlop = CLICK_SLOP_PX;
    let pointerDownType = "mouse";
    let pressClosesEditor = false;
    // OrbitControls' own pointerdown listener, added before this one, has
    // already taken the press by the time this runs.
    const onPointerDown = (event) => {
      // A second finger on the canvas while the first drags a handle: the
      // two of them are a pinch, and the camera's (drags.handOff()).
      drags.handOff(event.pointerId);
      pointerDownAt = [event.clientX, event.clientY];
      pointerDownSlop = slopFor(event.pointerType);
      pointerDownType = event.pointerType || "mouse";
      pressClosesEditor = editingIdRef.current !== null;
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);

    // The nearest hit-testable marker within `maxPx` of a point on screen
    // that the model does not hide, for a tap that missed every marker's
    // sphere: a hidden marker under the finger is no reason to pass over
    // a visible one a little further off. Candidates are tried nearest
    // first, so a tap usually costs one or two raycasts (one against a
    // 200k-triangle import is about 14 ms). Its own raycaster: the shared
    // one holds the tap's ray, which the surface pick or the model click
    // after a miss here still needs.
    const occlusionRay = new THREE.Raycaster();
    const nearestMarker = (group, clientX, clientY, maxPx) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const candidates = [];
      for (const marker of group.children) {
        if (!marker.userData.hitTest) continue;
        const at = toScreen([marker.position.x, marker.position.y, marker.position.z]);
        if (!at) continue;
        const distance = Math.hypot(at[0] - x, at[1] - y);
        if (distance < maxPx) candidates.push({ marker, distance });
      }
      candidates.sort((a, b) => a.distance - b.distance);
      const mesh = model();
      for (const { marker } of candidates) {
        if (!mesh) return marker;
        const toMarker = marker.position.clone().sub(camera.position);
        const span = toMarker.length() - marker.userData.radius;
        occlusionRay.set(camera.position, toMarker.normalize());
        if (!occlusionRay.intersectObject(mesh).some((hit) => hit.distance < span)) return marker;
      }
      return null;
    };

    // A raycast hit as the raw-hit callbacks report it: the triangle's
    // own geometric normal (not an interpolated vertex normal), in world
    // space, plus the click's modifier keys.
    const rawHit = (hit, mesh, event) => {
      const normal = hit.face.normal.clone().transformDirection(mesh.matrixWorld).normalize();
      return {
        point: [hit.point.x, hit.point.y, hit.point.z],
        normal: [normal.x, normal.y, normal.z],
        faceIndex: hit.faceIndex,
        altKey: Boolean(event?.altKey),
        shiftKey: Boolean(event?.shiftKey),
        // Millimetres per screen pixel at the hit, so a mode can size a
        // snap distance to a fingertip instead of to the model; and
        // whether it was a finger (or a pen) rather than a mouse.
        mmPerPx:
          (hit.distance * 2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, mount.clientHeight),
        // The event's own pointer when it says (a hover: an Apple Pencil
        // over an iPad, a mouse on a touch laptop), else the press's. `||`,
        // not `??`: a click no pointer made carries an empty pointerType.
        touch: (event?.pointerType || pointerDownType) !== "mouse",
      };
    };
    const onClick = (event) => {
      if (helpersHiddenRef.current || pressClosesEditor) return;
      if (
        pointerDownAt &&
        Math.hypot(event.clientX - pointerDownAt[0], event.clientY - pointerDownAt[1]) > pointerDownSlop
      ) {
        return;
      }
      clickAt(event);
    };
    // What a click at the event's point does — a marker, a surface pick,
    // a model click — once it is known to be one. The canvas's own click
    // gets here past the checks above; a press on a "move" handle that
    // never became a drag gets here from onHandlePointerUp, whose drag
    // already measured the travel against the same slop (and whose press
    // with a size box open only closed the box, as the canvas's does).
    /** @param {{ clientX: number, clientY: number } & ClickModifiers} event a click or a pointerup */
    const clickAt = (event) => {
      if (helpersHiddenRef.current) return;
      setPointer(event);

      const group = markerGroup();
      if (group && group.children.length) {
        const hits = raycaster.intersectObjects(group.children);
        if (hits.length) {
          callbacksRef.current?.onMarkerClick?.(hits[0].object.userData.id, modifiersOf(event));
          return;
        }
        if (pointerDownType !== "mouse") {
          const near = nearestMarker(group, event.clientX, event.clientY, TOUCH_PICK_PX);
          if (near) {
            callbacksRef.current?.onMarkerClick?.(near.userData.id, modifiersOf(event));
            return;
          }
        }
      }

      if (callbacksRef.current?.placingMode) {
        const mesh = model();
        if (!mesh) return;
        const hits = raycaster.intersectObject(mesh);
        if (!hits.length) return;
        if (callbacksRef.current.onSurfaceHit) {
          callbacksRef.current.onSurfaceHit(rawHit(hits[0], mesh, event));
          return;
        }
        if (mesh.geometry.index === null) return;
        const cluster = clusterFace(mesh.geometry, hits[0].faceIndex);
        // A degenerate (zero-area) triangle has no normal to place along.
        if (!cluster) return;
        const point = new THREE.Vector3(...cluster.point).applyMatrix4(mesh.matrixWorld);
        const normal = new THREE.Vector3(...cluster.normal).transformDirection(mesh.matrixWorld).normalize();
        callbacksRef.current?.onSurfacePick?.([point.x, point.y, point.z], [normal.x, normal.y, normal.z]);
        return;
      }

      if (callbacksRef.current?.onModelClick) {
        const mesh = model();
        const hits = mesh ? raycaster.intersectObject(mesh) : [];
        if (hits.length) {
          const p = hits[0].point;
          callbacksRef.current.onModelClick([p.x, p.y, p.z]);
        } else {
          callbacksRef.current.onModelClick(null);
        }
      }
    };
    renderer.domElement.addEventListener("click", onClick);

    // Hover work — the marker recolour, a raycast against the whole
    // model, the cursor, the Holes tab's hover report — runs once per
    // frame for the latest move, not once per event: a mouse (or an Apple
    // Pencil hovering over an iPad) reports moves faster than the display
    // draws, and one raycast against a 200k-triangle import takes about
    // 14 ms on a laptop, more than a frame on a tablet. The drag path
    // below schedules its previews the same way.
    let hoverEvent = null;
    let hoverFrame = null;
    const onPointerMove = (event) => {
      hoverEvent = {
        clientX: event.clientX,
        clientY: event.clientY,
        buttons: event.buttons,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        pointerType: event.pointerType,
      };
      if (hoverFrame === null) hoverFrame = requestAnimationFrame(runHover);
    };
    const runHover = () => {
      hoverFrame = null;
      const event = hoverEvent;
      hoverEvent = null;
      if (!event) return;
      if (helpersHiddenRef.current) {
        renderer.domElement.style.cursor = "default";
        return;
      }
      // A button is down: OrbitControls is orbiting or panning. Nothing
      // to hover, and the raycasts below (milliseconds each on a large
      // assembly) would run on every move of the drag.
      if (event.buttons !== 0) return;
      setPointer(event);
      const group = markerGroup();
      const hasMarkers = group && group.children.length;
      const markerHits = hasMarkers ? raycaster.intersectObjects(group.children) : [];
      if (hasMarkers) {
        const hitSet = new Set(markerHits.map((h) => h.object));
        let recolored = false;
        for (const marker of group.children) {
          const color = hitSet.has(marker) ? MARKER_HOVER_COLOR : (marker.userData.color ?? MARKER_COLOR);
          if (marker.material.color.getHex() !== color) {
            marker.material.color.setHex(color);
            recolored = true;
          }
        }
        if (recolored) requestRender();
      }

      const callbacks = callbacksRef.current;
      const mesh = model();
      // One raycast against the model serves both the cursor and the
      // hover report; neither is needed with nothing to do on a hit.
      const wantsModelHit = mesh && !markerHits.length && (callbacks?.placingMode || callbacks?.onModelClick);
      const modelHits = wantsModelHit ? raycaster.intersectObject(mesh) : [];

      let cursor = "default";
      if (markerHits.length) cursor = "pointer";
      else if (callbacks?.placingMode && modelHits.length) cursor = "crosshair";
      else if (callbacks?.onModelClick && modelHits.length) cursor = "pointer";
      renderer.domElement.style.cursor = cursor;

      if (callbacks?.placingMode && callbacks?.onSurfaceHover && !markerHits.length) {
        if (modelHits.length) {
          hoveringRef.current = true;
          callbacks.onSurfaceHover(rawHit(modelHits[0], mesh, event));
        } else if (hoveringRef.current) {
          hoveringRef.current = false;
          callbacks.onSurfaceHover(null);
        }
      }
    };
    const onPointerLeave = () => {
      // A move still queued for the next frame would otherwise set the
      // cursor and the hover after the pointer has gone.
      if (hoverFrame !== null) {
        cancelAnimationFrame(hoverFrame);
        hoverFrame = null;
        hoverEvent = null;
      }
      if (!hoveringRef.current) return;
      hoveringRef.current = false;
      callbacksRef.current?.onSurfaceHover?.(null);
    };
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("pointermove", onPointerMove);

    // --- Handle drags -------------------------------------------------------
    // Where the pointer's ray at (clientX, clientY) meets a handle's line
    // or plane, in model mm, or null inside dragMath.js's edge-on cone or
    // behind the camera.
    const intersect = (handle, clientX, clientY) => {
      setPointerAt(clientX, clientY);
      const origin = raycaster.ray.origin.toArray();
      const dir = raycaster.ray.direction.toArray();
      const c = handle.constraint;
      return c.type === "plane"
        ? rayPlanePoint(origin, dir, handle.point, c.normal ?? [0, 0, 1])
        : rayLinePoint(origin, dir, handle.point, c.dir ?? handle.dir);
    };
    // Where the pointer at (clientX, clientY) puts the dragged handle's
    // point on its constraint, in model mm, or null when nothing can be
    // read yet. The handle moves by the pointer's travel from the press,
    // not to the pointer: the grab target is drawn 12-18 px out from the
    // point it stands for and takes a press anywhere in its hit area, so
    // reading the pointer as the point itself would grow the part by that
    // much (a few mm at the Home framing) the moment a drag began.
    const constrainedPoint = (drag, clientX, clientY) => {
      const { handle } = drag;
      if (!drag.fallback) {
        const p = intersect(handle, clientX, clientY);
        if (p) return p.map((v, i) => handle.point[i] + v - drag.grab[i]);
        // The perspective took the constraint edge-on (or behind the
        // camera) mid-drag: read the rest of the gesture in screen space,
        // from the last point read and the pointer position it was read
        // at, so the handle carries on from there instead of jumping or
        // dropping the travel since (dragMath.js's screenAxisDelta()).
        drag.fallback = { at: drag.pointAt ?? drag.start, from: drag.point ?? handle.point };
      }
      const c = handle.constraint;
      const { at, from } = drag.fallback;
      const fromPx = toScreen(from);
      if (!fromPx) return null;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).toArray();
      const across = toScreen(from.map((v, i) => v + right[i] * FALLBACK_SEGMENT_MM));
      const faceOnPxPerMm = across
        ? Math.hypot(across[0] - fromPx[0], across[1] - fromPx[1]) / FALLBACK_SEGMENT_MM
        : 0;
      const delta = [clientX - at[0], clientY - at[1]];
      const point = [...from];
      for (const axis of constraintAxes(c, handle.dir)) {
        const end = toScreen(from.map((v, i) => v + axis[i] * FALLBACK_SEGMENT_MM));
        if (!end) continue;
        const mm = screenAxisDelta(fromPx, end, delta, FALLBACK_SEGMENT_MM, faceOnPxPerMm);
        if (mm !== null) for (let i = 0; i < 3; i++) point[i] += axis[i] * mm;
      }
      return point;
    };
    // A turn's preview (see `rotation` in the header): the angle round
    // the dial's centre from where the press met its plane, carried past
    // ±180° and snapped; the dial's lines follow it.
    const turnPreview = (drag) => {
      const turn = drag.rotate;
      setPointerAt(drag.client[0], drag.client[1]);
      const p = rayPlanePoint(
        raycaster.ray.origin.toArray(),
        raycaster.ray.direction.toArray(),
        turn.center,
        turn.axis,
      );
      if (p) {
        // A press on a dial seen edge-on starts reading where it first can.
        turn.from ??= p;
        const raw = planeAngle(turn.center, turn.axis, turn.from, p);
        if (raw !== null) {
          turn.total = unwrapAngle(turn.total, raw);
          const distance = Math.hypot(...p.map((v, i) => v - turn.center[i]));
          turn.angle = snapTurn(turn.base ?? 0, turn.total, dialStep(distance, turn.radius));
        }
      }
      if (!turn.from) return;
      turn.dial = dialSegments(turn, turn.from, turn.angle);
      drag.preview = handlePropsRef.current.onRotatePreview?.(turn.angle) ?? null;
    };
    const runPreview = () => {
      const drag = dragRef.current;
      if (!drag) return;
      drag.frame = null;
      if (drag.rotate) {
        turnPreview(drag);
        refreshGhost();
        if (frameId !== null) cancelAnimationFrame(frameId);
        renderFrame();
        return;
      }
      const point = constrainedPoint(drag, drag.client[0], drag.client[1]);
      if (point) {
        drag.point = point;
        drag.pointAt = drag.client;
      }
      if (!drag.point) return;
      drag.preview = handlePropsRef.current.onHandlePreview?.(drag.id, drag.point, drag.modifiers) ?? null;
      refreshGhost();
      // Drawn now, not on the frame refreshGhost() asked for: this runs as
      // a frame callback itself, and a frame requested from one is the
      // next one, so the ghost, the handles riding on it and the label
      // would trail the pointer by a frame for the whole drag.
      if (frameId !== null) cancelAnimationFrame(frameId);
      renderFrame();
    };
    const schedulePreview = () => {
      const drag = dragRef.current;
      if (drag?.active && drag.frame === null) drag.frame = requestAnimationFrame(runPreview);
    };
    // During a drag every key but the modifiers is the drag's: Esc
    // cancels it, and nothing else may act mid-gesture (Delete would
    // remove the part being resized, 1/2/3 unmount the mode). Capture
    // phase on window, so it runs before any other listener.
    const onDragKeyDown = (e) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (MODIFIER_KEYS.has(e.key)) {
        drag.modifiers = modifiersOf(e);
        schedulePreview();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") endDrag(false);
    };
    const onDragKeyUp = (e) => {
      const drag = dragRef.current;
      if (!drag || !MODIFIER_KEYS.has(e.key)) return;
      drag.modifiers = modifiersOf(e);
      schedulePreview();
    };
    const endDrag = (committed) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      if (drag.frame !== null) cancelAnimationFrame(drag.frame);
      window.removeEventListener("keydown", onDragKeyDown, true);
      window.removeEventListener("keyup", onDragKeyUp, true);
      try {
        if (drag.element.hasPointerCapture(drag.pointerId))
          drag.element.releasePointerCapture(drag.pointerId);
      } catch {
        // The element is gone (the handle unmounted): nothing holds the capture.
      }
      delete drag.element.dataset.dragging;
      if (root) delete root.dataset.handleDrag;
      handlePropsRef.current.onHandleEnd?.(drag.id, committed);
      refreshGhost();
    };
    const drags = {
      /**
       * @param {ViewerHandle} handle
       * @param {PointerEvent} event
       * @param {HTMLElement} element
       */
      start(handle, event, element) {
        if (dragRef.current) return;
        try {
          element.setPointerCapture(event.pointerId);
        } catch {
          return; // the pointer is already gone
        }
        const start = [event.clientX, event.clientY];
        // Alt with a rotation on offer: a turn, read on the dial's plane.
        const turn = event.altKey ? handlePropsRef.current.rotation : null;
        let turnFrom = null;
        if (turn) {
          setPointerAt(start[0], start[1]);
          turnFrom = rayPlanePoint(
            raycaster.ray.origin.toArray(),
            raycaster.ray.direction.toArray(),
            turn.center,
            turn.axis,
          );
        }
        // Where the press meets the constraint: the drag's zero. A press
        // already inside the edge-on cone (the handle is hidden there, so
        // rarely) reads the whole gesture in screen space instead.
        const grab = turn ? null : intersect(handle, start[0], start[1]);
        dragRef.current = {
          id: handle.id,
          handle,
          element,
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          // How far it may travel and still be a click (slopFor()).
          slop: slopFor(event.pointerType),
          start,
          client: start,
          modifiers: modifiersOf(event),
          // Past `slop`: a drag (ghost, others hidden), not a click that
          // opens the size box.
          active: false,
          frame: null,
          grab,
          // The last point read, and the pointer position it was read at.
          point: null,
          pointAt: null,
          preview: null,
          fallback: grab || turn ? null : { at: start, from: handle.point },
          rotate: turn ? { ...turn, from: turnFrom, total: 0, angle: 0, dial: [] } : null,
        };
        element.dataset.dragging = "";
        window.addEventListener("keydown", onDragKeyDown, true);
        window.addEventListener("keyup", onDragKeyUp, true);
        handlePropsRef.current.onHandleStart?.(handle.id);
      },
      /** @param {PointerEvent} event */
      move(event) {
        const drag = dragRef.current;
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag.client = [event.clientX, event.clientY];
        drag.modifiers = modifiersOf(event);
        if (
          !drag.active &&
          Math.hypot(event.clientX - drag.start[0], event.clientY - drag.start[1]) > drag.slop
        ) {
          drag.active = true;
          if (root) root.dataset.handleDrag = "";
        }
        schedulePreview();
      },
      /**
       * @param {PointerEvent} event
       * @returns {string | null} the id of a handle that was clicked rather than dragged
       */
      up(event) {
        const drag = dragRef.current;
        if (!drag || event.pointerId !== drag.pointerId) return null;
        // A release past the slop is a drag even if no move reported it
        // (a fast flick can come up before its last pointermove).
        if (Math.hypot(event.clientX - drag.start[0], event.clientY - drag.start[1]) > drag.slop) {
          drag.active = true;
        }
        if (!drag.active) {
          endDrag(false);
          // An Alt-press that never turned is not a click on the handle.
          return drag.rotate ? null : drag.id;
        }
        // The commit uses the pointer's last position, not the last
        // frame's: flush that one preview so the ghost, the label and the
        // commit agree.
        if (drag.frame !== null) cancelAnimationFrame(drag.frame);
        drag.client = [event.clientX, event.clientY];
        drag.modifiers = modifiersOf(event);
        runPreview();
        if (drag.rotate) {
          const { angle } = drag.rotate;
          if (angle !== 0) handlePropsRef.current.onRotateCommit?.(angle);
          endDrag(angle !== 0);
          return null;
        }
        const { id, point, modifiers } = drag;
        if (point) handlePropsRef.current.onHandleCommit?.(id, point, modifiers);
        endDrag(!!point);
        return null;
      },
      /**
       * Ends the drag without a commit. With a `pointerId`, only if the
       * drag is that pointer's: a handle losing the capture of a second
       * finger (which OrbitControls takes for a pinch) is no reason to drop
       * the first finger's gesture.
       * @param {number | null} [pointerId]
       */
      cancel(pointerId = null) {
        const drag = dragRef.current;
        if (!drag || (pointerId !== null && pointerId !== drag.pointerId)) return;
        endDrag(false);
      },
      /**
       * Another pointer went down — a second finger on the canvas or on a
       * handle — while this drag runs: the two are a pinch or a two-finger
       * pan, not a resize. The drag ends without a commit, and the finger
       * that was dragging is handed to OrbitControls as if it had come
       * down on the canvas, so OrbitControls tracks both and pinches (a
       * mouse or pen drag just ends). Left alone, the first finger went on
       * resizing while the second turned the camera, and lifting it
       * committed the size.
       * @param {number} pointerId the pointer that just went down
       */
      handOff(pointerId) {
        const drag = dragRef.current;
        if (!drag || pointerId === drag.pointerId) return;
        // Ended first: the pointerdown below reaches the canvas's own
        // listener, which asks this again.
        endDrag(false);
        if (drag.pointerType !== "touch") return;
        const canvas = renderer.domElement;
        try {
          canvas.setPointerCapture(drag.pointerId);
        } catch {
          return; // the finger has already lifted
        }
        canvas.dispatchEvent(
          new PointerEvent("pointerdown", {
            pointerId: drag.pointerId,
            pointerType: "touch",
            isPrimary: true,
            button: 0,
            buttons: 1,
            clientX: drag.client[0],
            clientY: drag.client[1],
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      runningId() {
        return dragRef.current?.id ?? null;
      },
    };

    // Sized to the mount, and re-sized whenever the mount changes — a
    // window resize, but also the sidebar collapsing, which widens the
    // viewer without any window event.
    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      applyPixelRatio();
      renderer.setSize(w, h);
      requestRender();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    // A window dragged to a screen of another density changes
    // devicePixelRatio but not the mount's CSS size, so the observer
    // above never hears of it. The query matches only the current ratio,
    // so it is re-armed for the new one after each change.
    let dprQuery = null;
    const onDprChange = () => {
      applyPixelRatio();
      resize();
      armDprQuery();
    };
    const armDprQuery = () => {
      dprQuery?.removeEventListener("change", onDprChange);
      dprQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) ?? null;
      dprQuery?.addEventListener("change", onDprChange);
    };
    armDprQuery();

    // With damping on, OrbitControls goes on applying what is left of the
    // user's last orbit or pan for a second or two after the release —
    // 5% a frame, from wherever the camera is by then. A pose set in that
    // time (Fit, a View, a dolly that keeps handles in reach) would be
    // turned and panned off what it was worked out for: View → Top just
    // after a flick ended a few degrees off, F after a pan off centre. So
    // the leftover is dropped first: update() with damping off spends it
    // at once and zeroes it, and the camera goes back to where it stood.
    const dropLeftoverMotion = () => {
      const position = camera.position.clone();
      const target = controls.target.clone();
      controls.enableDamping = false;
      controls.update();
      controls.enableDamping = true;
      camera.position.copy(position);
      controls.target.copy(target);
    };
    // Puts the camera at `pose`, with clip planes for a model of `clipBox`'s
    // size (as the first fit sets them) that also reach the pose's distance.
    const applyPose = (pose, clipBox) => {
      dropLeftoverMotion();
      controls.target.set(pose.target[0], pose.target[1], pose.target[2]);
      camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
      const radius = modelRadius(clipBox);
      const { near, far } = clipPlanes(radius);
      camera.near = near;
      camera.far = Math.max(far, camera.position.distanceTo(controls.target) + 2 * radius);
      camera.updateProjectionMatrix();
      controls.update();
      requestRender();
    };
    const view = {
      fit() {
        const box = fitBoxRef.current ?? modelBoxRef.current;
        if (!box) return;
        const pose = fitView({
          box,
          position: camera.position.toArray(),
          target: controls.target.toArray(),
          fovDeg: camera.fov,
          aspect: camera.aspect,
        });
        applyPose(pose, modelBoxRef.current ?? box);
      },
      /** @param {import("../lib/viewerCamera.js").ViewName} name */
      preset(name) {
        const box = modelBoxRef.current;
        if (box) applyPose(presetViewFitting(name, box, { fovDeg: camera.fov, aspect: camera.aspect }), box);
      },
      /** @param {Box} box */
      showModel(box) {
        const center = boxCenter(box);
        const radius = modelRadius(box);
        const mode = refitMode(fitRef.current, fitKeyRef.current, center, radius);
        if (mode === "fit")
          applyPose(presetViewFitting("home", box, { fovDeg: camera.fov, aspect: camera.aspect }), box);
        else if (mode === "contain") {
          // Same subject, new size: the view stays where the user put it
          // (TinkerCAD never moves the camera for a resize), backing out
          // only when the new box would leave it.
          const position = dollyToFit({
            box,
            position: camera.position.toArray(),
            target: controls.target.toArray(),
            fovDeg: camera.fov,
            aspect: camera.aspect,
          });
          if (position) {
            dropLeftoverMotion();
            camera.position.set(position[0], position[1], position[2]);
          }
          camera.far = Math.max(camera.far, clipPlanes(radius).far);
          camera.updateProjectionMatrix();
          controls.update();
        }
        fitRef.current = { key: fitKeyRef.current, center, radius };
        modelBoxRef.current = box;
        requestRender();
      },
    };

    // --- Handles in reach ----------------------------------------------------
    // What lies over the viewer and takes a press before a handle under it
    // would: the toolbar's controls, and whatever else the viewer's parent
    // lays over it (Library's download buttons, an error note). Mount px,
    // [left, top, right, bottom].
    const chromeRects = () => {
      const base = mount.getBoundingClientRect();
      /** @type {number[][]} */
      const rects = [];
      const add = (/** @type {Element} */ el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          rects.push([r.left - base.left, r.top - base.top, r.right - base.left, r.bottom - base.top]);
        }
      };
      root?.querySelectorAll(".viewer-toolbar > *").forEach(add);
      for (const el of root?.parentElement?.children ?? []) if (el !== root) add(el);
      return rects;
    };
    // Handles that grew — a commit's, an arrow step's or a sidebar edit's
    // predicted box, before its render lands — can end up off the edge or
    // under the chrome, and the focused one walks off screen an arrow press
    // at a time. So the camera backs out along the way it looks (never in)
    // just far enough that every handle that could be grabbed before still
    // can: shown, wholly inside the viewer, clear of the chrome. Plus the
    // focused handle, which the keyboard is stepping wherever it was.
    // `previous` is the list last laid out; a new selection (no id in
    // common) or a shrink moves nothing (viewerCamera.js's handlesGrew()).
    const keepHandlesInReach = (previous) => {
      const list = handlesRef.current;
      if (dragRef.current || !previous.length || !list.length || !handlesGrew(previous, list)) return;
      // The hit area's size (20 or 44 px, by pointer); none mounted means
      // the helpers are hidden, and there is nothing to reach.
      const sample = handleElements.current.values().next().value;
      if (!sample) return;
      const half = sample.offsetWidth / 2;
      const reachView = {
        width: mount.clientWidth,
        height: mount.clientHeight,
        obstacles: chromeRects(),
        gap: REACH_GAP_PX,
      };
      const reachable = (states) =>
        new Set(
          states
            .filter(
              (s) =>
                s.state === "shown" &&
                inReach([s.at[0] + s.offset[0], s.at[1] + s.offset[1]], half, reachView),
            )
            .map((s) => s.handle.id),
        );
      const ids = new Set(list.map((h) => h.id));
      const wanted = [...reachable(layoutHandles(previous))].filter((id) => ids.has(id));
      const active = document.activeElement;
      const focused =
        active instanceof HTMLElement && root?.contains(active) ? active.dataset.handleId : undefined;
      if (focused && ids.has(focused) && !wanted.includes(focused)) wanted.push(focused);
      if (!wanted.length) return;
      // The handles' points and their sides' far ends are the predicted
      // box's corners and face centres: inside the margin a model gets when
      // it lands (dollyToFit()), so that render moves the camera no further.
      const boxPoints = list.flatMap((h) =>
        h.span ? [h.point, h.point.map((v, i) => v + h.span[i])] : [h.point],
      );
      const inMargin = (p) => {
        projected.set(p[0], p[1], p[2]).project(camera);
        return (
          projected.z <= 1 &&
          Math.abs(projected.x) <= CONTAIN_MARGIN &&
          Math.abs(projected.y) <= CONTAIN_MARGIN
        );
      };
      // A handle that doesn't show from there (edge-on, faded behind its
      // mirror) needs no reaching.
      const fits = () => {
        if (!boxPoints.every(inMargin)) return false;
        const states = layoutHandles(list);
        const ok = reachable(states);
        return states.every(
          (s) => s.state !== "shown" || !wanted.includes(s.handle.id) || ok.has(s.handle.id),
        );
      };
      const target = controls.target.clone();
      const back = camera.position.clone().sub(target);
      const current = back.length();
      if (!(current > 0)) return;
      back.divideScalar(current);
      // How far from the target anything to keep in front of the far clip
      // plane lies (a point beyond it would read as behind the camera).
      let spread = 0;
      const reachTo = (p) => {
        spread = Math.max(spread, target.distanceTo(new THREE.Vector3(p[0], p[1], p[2])));
      };
      for (const h of list) {
        reachTo(h.point);
        if (h.span) reachTo(h.point.map((v, i) => v + h.span[i]));
      }
      const model = modelBoxRef.current;
      if (model) {
        for (const x of [model.min[0], model.max[0]])
          for (const y of [model.min[1], model.max[1]])
            for (const z of [model.min[2], model.max[2]]) reachTo([x, y, z]);
      }
      const saved = { position: camera.position.clone(), far: camera.far };
      const place = (distance) => {
        camera.position.copy(target).addScaledVector(back, distance);
        camera.far = Math.max(saved.far, (distance + spread) * 1.05);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
      };
      const distance = dollyOutDistance((d) => {
        place(d);
        return fits();
      }, current);
      if (distance === null) {
        camera.position.copy(saved.position);
        camera.far = saved.far;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        return;
      }
      // A leftover flick would carry the handles back out of reach.
      dropLeftoverMotion();
      place(distance);
      controls.update();
      requestRender();
    };

    sceneRef.current = {
      scene,
      camera,
      renderer,
      controls,
      requestRender,
      positionDom,
      refreshGhost,
      drags,
      clickAt,
      view,
      keepHandlesInReach,
    };
    // A ghost already set at mount: the effect that follows the prop ran
    // before there was a scene to draw it in.
    refreshGhost();
    // The same for the handles: the layout effect that records what it
    // laid out ran before there was a scene, and the first frame draws
    // these — the "before" of the first resize.
    laidOutRef.current = handlesRef.current;

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      // Unmounted mid-drag: drop the window listeners and the capture.
      // No onHandleEnd — the mode is going away with the viewer.
      const drag = dragRef.current;
      if (drag) {
        dragRef.current = null;
        if (drag.frame !== null) cancelAnimationFrame(drag.frame);
        window.removeEventListener("keydown", onDragKeyDown, true);
        window.removeEventListener("keyup", onDragKeyUp, true);
      }
      dprQuery?.removeEventListener("change", onDprChange);
      observer.disconnect();
      controls.removeEventListener("change", requestRender);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
      window.removeEventListener("sidebar-drawer", requestRender);
      document.removeEventListener("visibilitychange", onVisible);
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      if (hoverFrame !== null) cancelAnimationFrame(hoverFrame);
      disposeModel(scene);
      disposeMarkers(scene);
      disposeGuides(scene);
      disposeHighlight(scene);
      scene.remove(ghostLines);
      ghostLines.geometry.dispose();
      ghostMaterial.dispose();
      scene.remove(dialLines);
      dialLines.geometry.dispose();
      dialMaterial.dispose();
      grid.geometry.dispose();
      grid.material.dispose();
      renderer.dispose();
      // dispose() frees three's resources but not the WebGL context
      // itself; browsers cap live contexts (~16), and every tab switch
      // mounts a new viewer, so without this the oldest canvas is
      // eventually killed with "Too many active WebGL contexts".
      renderer.forceContextLoss();
      mount.removeChild(renderer.domElement);
      sceneRef.current = null;
      builtGuidesRef.current = null;
      overlayPinnedRef.current = null;
      // A remounted scene (StrictMode does it once in development) starts
      // with a fresh camera: its first model is a first model again.
      fitRef.current = null;
      modelBoxRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!sceneRef.current) return;
    const { scene, view } = sceneRef.current;
    if (!stlBuffer && !geometry) return;

    disposeModel(scene);

    const owned = !geometry;
    const geom = geometry || new STLLoader().parse(stlBuffer);
    if (owned) geom.computeVertexNormals();
    geom.computeBoundingBox();

    const material = new THREE.MeshStandardMaterial({ color: MODEL_COLOR, metalness: 0.1, roughness: 0.6 });
    const mesh = new THREE.Mesh(geom, material);
    mesh.name = "model";
    mesh.userData.ownsGeometry = owned;
    scene.add(mesh);

    // The camera follows fitKey (viewerCamera.js's refitMode()): a new
    // subject gets the Home framing, a resize of the same one keeps the
    // view. A Bench part turned in place, or a hole drilled into a plate,
    // leaves it where the user put it either way.
    const { min, max } = geom.boundingBox;
    view.showModel({ min: min.toArray(), max: max.toArray() });
  }, [stlBuffer, geometry]);

  useEffect(() => {
    callbacksRef.current = {
      onMarkerClick,
      placingMode,
      onSurfacePick,
      onSurfaceHit,
      onSurfaceHover,
      onModelClick,
    };
  }, [onMarkerClick, placingMode, onSurfacePick, onSurfaceHit, onSurfaceHover, onModelClick]);

  useEffect(() => {
    if (!sceneRef.current) return;
    const { scene, requestRender } = sceneRef.current;
    const key = highlightKey(highlightBox);
    const built = builtHighlightRef.current;
    if (built && built.scene === scene && built.key === key) return;
    builtHighlightRef.current = { scene, key };
    disposeHighlight(scene);
    if (highlightBox) {
      const box = new THREE.Box3(
        new THREE.Vector3(...highlightBox.min),
        new THREE.Vector3(...highlightBox.max),
      );
      // A hair outside the part so the lines don't z-fight its faces.
      box.expandByScalar(HIGHLIGHT_PAD_MM);
      const helper = new THREE.Box3Helper(box, HIGHLIGHT_COLOR);
      helper.name = "highlight";
      helper.visible = !helpersHiddenRef.current;
      scene.add(helper);
    }
    requestRender();
  }, [highlightBox]);

  useEffect(() => {
    labelsRef.current = labels ?? [];
    sceneRef.current?.requestRender();
  }, [labels]);

  // `children` is a new element on every render of the mode, and the Bench
  // hands over a fresh anchor array each time: a frame is only worth
  // drawing when the anchor actually moved or the overlay element is a
  // different one from the last positioned.
  useEffect(() => {
    const el = overlayRef.current;
    const key = overlayAnchor ? overlayAnchor.join(",") : "";
    const pinned = overlayPinnedRef.current;
    if (pinned && pinned.key === key && pinned.el === el) return;
    overlayPinnedRef.current = { key, el };
    overlayAnchorRef.current = overlayAnchor ?? null;
    if (el && !overlayAnchor) {
      // Docked: CSS places it; clear whatever the last projection left.
      el.style.transform = "";
      el.style.visibility = "";
    }
    sceneRef.current?.requestRender();
  }, [overlayAnchor, children]);

  useEffect(() => {
    if (!sceneRef.current) return;
    const { scene, requestRender } = sceneRef.current;

    const key = markersKey(markers);
    const built = builtMarkersRef.current;
    if (built && built.scene === scene && built.key === key) return;
    builtMarkersRef.current = { scene, key };
    // The old markers leave the scene now, but are disposed only once the
    // next frame has drawn the new ones: three.js deletes a shader program
    // when the last material using it goes, so disposing first had every
    // rebuild — each hover that moves the Holes tab's snap highlight —
    // link the marker program again (26 of 34 s of a profiled hover sweep
    // under SwiftShader). A frame later the new materials hold it.
    const retired = scene.getObjectByName("markers");
    if (retired) scene.remove(retired);
    if (markers && markers.length) {
      const group = new THREE.Group();
      group.name = "markers";
      // One geometry per distinct shape and radius, shared by every
      // marker of that kind, instead of a fresh tessellation per marker.
      const geometryByRadius = new Map();
      const up = new THREE.Vector3(0, 0, 1);
      for (const marker of markers) {
        const radius = marker.radius ?? DEFAULT_MARKER_RADIUS;
        const shape = marker.shape === "ring" ? "ring" : "sphere";
        const key = `${shape}:${radius}`;
        let geom = geometryByRadius.get(key);
        if (!geom) {
          geom =
            shape === "ring"
              ? new THREE.RingGeometry(radius * 0.7, radius, 48)
              : new THREE.SphereGeometry(radius, 16, 16);
          geometryByRadius.set(key, geom);
        }
        const color = marker.color ?? MARKER_COLOR;
        const object = new THREE.Mesh(
          geom,
          new THREE.MeshBasicMaterial({ color, side: shape === "ring" ? THREE.DoubleSide : THREE.FrontSide }),
        );
        object.position.set(marker.x, marker.y, marker.z);
        if (shape === "ring" && marker.normal) {
          // Flat on the surface, lifted a hair off it so it doesn't
          // z-fight the face it outlines.
          const normal = new THREE.Vector3(...marker.normal).normalize();
          object.quaternion.setFromUnitVectors(up, normal);
          object.position.addScaledVector(normal, 0.08);
        }
        object.userData.id = marker.id;
        object.userData.color = color;
        object.userData.radius = radius;
        object.userData.hitTest = marker.hitTest !== false;
        if (marker.hitTest === false) object.raycast = () => {};
        group.add(object);
      }
      group.userData.geometries = [...geometryByRadius.values()];
      group.visible = !helpersHiddenRef.current;
      scene.add(group);
    }
    requestRender();
    // Queued after requestRender()'s frame, so it runs once that has drawn.
    if (retired) requestAnimationFrame(() => disposeMarkerGroup(retired));
  }, [markers]);

  useEffect(() => {
    if (!sceneRef.current) return;
    const { scene, requestRender } = sceneRef.current;
    const key = guidesKey(guides);
    const built = builtGuidesRef.current;
    if (built && built.scene === scene && built.key === key) return;
    builtGuidesRef.current = { scene, key };
    disposeGuides(scene);
    if (guides && guides.length) {
      const group = new THREE.Group();
      group.name = "guides";
      // One object per style (solid/dashed × colour), all of that
      // style's segments in a single buffer.
      const byStyle = new Map();
      for (const g of guides) {
        const key = `${g.dashed ? "d" : "s"}:${g.color ?? 0xffffff}`;
        if (!byStyle.has(key))
          byStyle.set(key, { dashed: Boolean(g.dashed), color: g.color ?? 0xffffff, points: [] });
        byStyle.get(key).points.push(...g.a, ...g.b);
      }
      for (const { dashed, color, points } of byStyle.values()) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
        const material = dashed
          ? new THREE.LineDashedMaterial({
              color,
              dashSize: 0.8,
              gapSize: 0.5,
              transparent: true,
              opacity: 0.7,
            })
          : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
        const lines = new THREE.LineSegments(geom, material);
        if (dashed) lines.computeLineDistances();
        group.add(lines);
      }
      group.visible = !helpersHiddenRef.current;
      scene.add(group);
    }
    requestRender();
  }, [guides]);

  useEffect(() => {
    helpersHiddenRef.current = helpersHidden;
    if (!sceneRef.current) return;
    const { scene, renderer, requestRender, drags } = sceneRef.current;
    for (const name of HELPER_OBJECTS) {
      const object = scene.getObjectByName(name);
      if (object) object.visible = !helpersHidden;
    }
    if (helpersHidden) {
      renderer.domElement.style.cursor = "default";
      if (hoveringRef.current) {
        hoveringRef.current = false;
        callbacksRef.current?.onSurfaceHover?.(null);
      }
      // The handles go with the helpers; so does a gesture on one.
      drags.cancel();
      setEditingId(null);
    }
    // Also re-pins the overlay and labels coming back.
    requestRender();
  }, [helpersHidden]);

  // New handle elements (and a readout) are placed before the browser
  // paints them (a frame later they would flash at the corner), handles
  // that grew get the camera backed out to reach them before they show
  // out of reach, and a drag or size box whose handle went away (a render
  // error, another part) ends with it.
  useLayoutEffect(() => {
    const current = sceneRef.current;
    if (!current) return;
    const ids = new Set(handleList.map((h) => h.id));
    const running = current.drags.runningId();
    if (running !== null && !ids.has(running)) current.drags.cancel();
    if (editingIdRef.current !== null && !ids.has(editingIdRef.current)) setEditingId(null);
    // A handle that unmounts under the pointer (H, a deselect, an undo to
    // another part) gets no pointerleave from React, so its readout — or
    // the timer still counting towards it — would outlive it and come
    // back, unasked, with the next handle of that id ("x+" is every
    // part's).
    const readout = readoutIdRef.current;
    if (helpersHidden || !ids.size || (readout !== null && !ids.has(readout))) {
      clearTimeout(readoutTimer.current);
      if (readout !== null) setReadoutId(null);
    }
    current.camera.updateMatrixWorld();
    if (laidOutRef.current !== handleList) {
      current.keepHandlesInReach(laidOutRef.current);
      laidOutRef.current = handleList;
    }
    current.positionDom();
  }, [handleList, helpersHidden, editingId, readoutId]);

  // The mode's pending ghost, drawn whenever no drag is running.
  useLayoutEffect(() => {
    sceneRef.current?.refreshGhost();
  }, [ghost, helpersHidden]);

  // Alt held over a viewer that offers a turn: the handles take a turning
  // cursor, so the mode an Alt-press starts is plain before the press
  // (data-rotate-ready on the root, styles.css). Cleared on release, and
  // when the window loses focus with Alt down (an Alt+Tab), whose keyup
  // never arrives.
  const canRotate = !!rotation;
  useEffect(() => {
    const root = rootRef.current;
    if (!canRotate || !root) return;
    const sync = (e) => {
      if (e.altKey) root.dataset.rotateReady = "";
      else delete root.dataset.rotateReady;
    };
    const clear = () => delete root.dataset.rotateReady;
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
      clear();
    };
  }, [canRotate]);

  useEffect(() => () => clearTimeout(readoutTimer.current), []);

  // H toggles the helpers and F fits the view. Not while typing, not
  // with Cmd/Ctrl/Alt held, and not from behind an open dialog this
  // viewer isn't in (the Bench's own viewer under its STL import, which
  // has a viewer of its own).
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      if (key !== "h" && key !== "f") return;
      if (ignoresShortcut(e, mountRef.current)) return;
      if (key === "h") setHelpersHidden((hidden) => !hidden);
      else sceneRef.current?.view.fit();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The same, and the View menu's cameras, in the command palette. None
  // from a viewer inside a dialog (the STL import's preview): the palette
  // is for the workspace, and two viewers' "Fit" would be one too many.
  useCommands("viewer", () => {
    if (webglError || !mountRef.current || mountRef.current.closest("dialog")) return [];
    const view = (id, label) => ({
      id: `view.preset:${id}`,
      title: `${label} view`,
      section: "Views",
      keywords: ["camera", "look from"],
      actions: [{ title: "Look", run: () => sceneRef.current?.view.preset(id) }],
    });
    return [
      builtin("view.fit", { run: () => sceneRef.current?.view.fit() }),
      builtin("view.helpers", {
        title: helpersHidden ? "Show the helpers" : "Hide the helpers",
        run: () => setHelpersHidden((hidden) => !hidden),
      }),
      builtin("view.camera", {
        page: () => ({
          id: "views",
          title: "View from",
          searchLabel: "Search views",
          items: () => VIEW_PRESETS.map(({ id, label }) => view(id, label)),
        }),
      }),
      ...VIEW_PRESETS.map(({ id, label }) => ({ ...view(id, label), searchOnly: true })),
    ];
  });

  // The wheel over a handle (or its readout) zooms the view as it would
  // a pixel away, instead of scrolling the page under it. React's onWheel
  // is passive, so this needs a listener of its own to preventDefault.
  const handlesLayerRef = useRef(null);
  const showHandles = handleList.length > 0 && !helpersHidden;
  useEffect(() => {
    const layer = handlesLayerRef.current;
    if (!layer) return undefined;
    const onWheel = (e) => {
      if (!(e.target instanceof Element) || !e.target.closest(".viewer-handle")) return;
      const canvas = sceneRef.current?.renderer.domElement;
      if (!canvas) return;
      e.preventDefault();
      canvas.dispatchEvent(new WheelEvent("wheel", e));
    };
    layer.addEventListener("wheel", onWheel, { passive: false });
    return () => layer.removeEventListener("wheel", onWheel);
  }, [showHandles]);

  const hideReadout = () => {
    clearTimeout(readoutTimer.current);
    setReadoutId(null);
  };
  const scheduleReadout = (id) => {
    clearTimeout(readoutTimer.current);
    readoutTimer.current = setTimeout(() => setReadoutId(id), HANDLE_READOUT_MS);
  };

  /**
   * @param {ViewerHandle} handle
   * @param {import("react").PointerEvent<HTMLDivElement>} e
   */
  const onHandlePointerDown = (handle, e) => {
    const current = sceneRef.current;
    if (!current) return;
    if (!e.isPrimary || e.button !== 0) {
      // The middle and right buttons (and a second finger) pan, dolly
      // and pinch the view as they would a pixel away: hand the press to
      // the canvas, where OrbitControls takes the rest of the gesture. A
      // first finger dragging a handle goes to it first (drags.handOff()),
      // so it sees both fingers. The canvas captures this pointer itself:
      // OrbitControls only captures the first of a gesture's pointers, and
      // a finger's moves would otherwise stay with the handle it landed on.
      e.preventDefault();
      current.drags.handOff(e.pointerId);
      const canvas = current.renderer.domElement;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        return; // the pointer is already gone
      }
      canvas.dispatchEvent(new PointerEvent("pointerdown", e.nativeEvent));
      return;
    }
    // No focus from a press: after a mouse drag the arrow keys must go on
    // nudging what they nudged (a Bench part, the Holes selection), not
    // resize. Keyboard focus comes from Tab, shown by :focus-visible.
    e.preventDefault();
    hideReadout();
    if (editingIdRef.current !== null) {
      // With a size box open, a press anywhere only closes it, committing
      // what was typed (as a press on the canvas does): blur its field,
      // which the cancelled pointerdown above would otherwise keep.
      const active = document.activeElement;
      if (active instanceof HTMLElement && editorElementRef.current?.contains(active)) active.blur();
      else setEditingId(null);
      return;
    }
    // The press takes no focus, but it does take it away from a field
    // outside the viewer, as a press on the canvas would: a sidebar field
    // left focused would keep
    // Cmd/Ctrl+Z for its own undo (not the resize's) and the arrow keys
    // for its own steps (not the nudge). Focus inside the viewer — a
    // handle, the overlay's controls — stays.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !rootRef.current?.contains(active)) {
      active.blur();
    }
    current.drags.start(handle, e.nativeEvent, e.currentTarget);
  };
  /** @param {import("react").PointerEvent<HTMLDivElement>} e */
  const onHandlePointerUp = (e) => {
    const clicked = sceneRef.current?.drags.up(e.nativeEvent);
    const handle = clicked ? handleList.find((h) => h.id === clicked) : null;
    // A press that didn't travel is TinkerCAD's "click the handle, type
    // the size".
    if (handle?.editable) setEditingId(handle.id);
    // A "move" handle stands on the very spot it moves (a hole's centre),
    // so a click on it is the click on the canvas under it, modifiers
    // and all: Holes selects that hole, or with Shift takes it out of the
    // selection — which, before the handle covered the spot, the canvas
    // did. Not the other kinds: they are drawn off the body, where the
    // canvas under them would deselect (the Bench) or drill a second hole
    // beside the first (Holes) on a grab that merely didn't move.
    else if (handle?.kind === "move") sceneRef.current?.clickAt(e.nativeEvent);
  };
  /**
   * @param {ViewerHandle} handle
   * @param {import("react").KeyboardEvent<HTMLDivElement>} e
   */
  const onHandleKeyDown = (handle, e) => {
    // Cmd/Ctrl/Alt+arrow belong to the OS and the browser.
    if (hasCommandModifier(e) || sceneRef.current?.drags.runningId()) return;
    let steps = 0;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") steps = 1;
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") steps = -1;
    // A held Enter opens the box once; its repeats would land in the box
    // and close it again.
    else if (e.key !== "Enter" || !handle.editable || e.repeat) return;
    // Handled here: not a page scroll, and not the Bench's or Holes'
    // arrow keys for their selection.
    e.preventDefault();
    e.stopPropagation();
    if (steps) handlePropsRef.current.onHandleStep?.(handle.id, steps, modifiersOf(e));
    else {
      hideReadout();
      setEditingId(handle.id);
    }
  };
  /** @param {{ value: number | null, refocus: boolean }} result */
  const closeEditor = ({ value, refocus }) => {
    const id = editingIdRef.current;
    setEditingId(null);
    if (id === null) return;
    if (value !== null && Number.isFinite(value)) handlePropsRef.current.onHandleSet?.(id, value);
    const handle = handlesRef.current.find((h) => h.id === id);
    // Enter or Esc gives focus back to the handle, as a dialog returns it
    // to its opener; focus that left for something else stays there.
    if (refocus && handle?.tabbable) handleElements.current.get(id)?.focus({ preventScroll: true });
  };

  if (webglError) {
    return (
      <div className="viewer-placeholder viewer-unavailable" role="alert">
        <p>
          This browser can't show the 3D preview (WebGL is unavailable). Rendering and downloads still work.
        </p>
      </div>
    );
  }
  const editingHandle = editingId !== null ? handleList.find((h) => h.id === editingId) : null;
  const overlayClass = overlayAnchor ? "viewer-overlay" : "viewer-overlay viewer-overlay-docked";
  return (
    <div ref={rootRef} className={editingHandle ? "viewer-canvas is-editing-handle" : "viewer-canvas"}>
      <div ref={mountRef} className="viewer-canvas-mount" />
      <div className="viewer-toolbar">
        {toolbar}
        {gridControl && <GridSelect />}
        <button
          type="button"
          className="viewer-tool viewer-fit"
          aria-label="Fit view"
          title={fitBox ? "Fit the view to the selection (F)" : "Fit the view to the model (F)"}
          onClick={() => sceneRef.current?.view.fit()}
        >
          <FitIcon />
        </button>
        <ViewMenu onPick={(name) => sceneRef.current?.view.preset(name)} />
        <button
          type="button"
          className="viewer-helpers-toggle"
          aria-pressed={!helpersHidden}
          onClick={() => setHelpersHidden((hidden) => !hidden)}
          title={
            helpersHidden
              ? "Show the grid, markers, guides and handles again (H)"
              : "Hide the grid, markers, guides, labels and handles to see just the model (H)"
          }
        >
          <EyeIcon closed={helpersHidden} />
          <span className="viewer-helpers-label">Helpers</span>
        </button>
      </div>
      {children && !helpersHidden && (
        <div ref={overlayRef} className={overlayClass}>
          {children}
        </div>
      )}
      {labels && labels.length > 0 && !helpersHidden && (
        <div className="viewer-labels" aria-hidden="true">
          {labels.map((label) => (
            <div
              key={label.id}
              className="viewer-label"
              ref={(el) => {
                if (el) labelElements.current.set(label.id, el);
                else labelElements.current.delete(label.id);
              }}
            >
              {label.text}
            </div>
          ))}
        </div>
      )}
      {/* Its text is written by the drag (refreshGhost), outside React. */}
      <div ref={dragLabelRef} className="viewer-drag-label" aria-hidden="true" hidden={helpersHidden} />
      {showHandles && (
        <div className="viewer-handles" ref={handlesLayerRef}>
          {handleList.map((handle) => (
            <div
              key={handle.id}
              ref={(el) => {
                if (el) handleElements.current.set(handle.id, el);
                else handleElements.current.delete(handle.id);
              }}
              className={`viewer-handle viewer-handle-${handle.kind}`}
              role="slider"
              tabIndex={handle.tabbable ? 0 : -1}
              aria-hidden={handle.tabbable ? undefined : true}
              aria-label={handle.label}
              aria-valuenow={handle.value}
              aria-valuetext={handle.valueText}
              aria-valuemin={handle.min}
              aria-valuemax={handle.max}
              data-handle-id={handle.id}
              onPointerDown={(e) => onHandlePointerDown(handle, e)}
              onPointerMove={(e) => sceneRef.current?.drags.move(e.nativeEvent)}
              onPointerUp={onHandlePointerUp}
              onPointerCancel={(e) => sceneRef.current?.drags.cancel(e.pointerId)}
              onLostPointerCapture={(e) => sceneRef.current?.drags.cancel(e.pointerId)}
              // Chromium focuses on mousedown even after a cancelled
              // pointerdown; this keeps a press from taking focus there.
              onMouseDown={(e) => e.preventDefault()}
              onContextMenu={(e) => e.preventDefault()}
              onKeyDown={(e) => onHandleKeyDown(handle, e)}
              onPointerEnter={() => scheduleReadout(handle.id)}
              onPointerLeave={hideReadout}
              // A focused handle is never faded (layoutHandles()): re-lay
              // the handles out as focus comes and goes.
              onFocus={() => {
                scheduleReadout(handle.id);
                sceneRef.current?.requestRender();
              }}
              onBlur={() => {
                hideReadout();
                sceneRef.current?.requestRender();
              }}
            >
              {handle.kind === "top" && <span className="viewer-handle-stem" />}
              <span className="viewer-handle-dot" />
              {readoutId === handle.id && editingId === null && (
                <span className="viewer-handle-readout" aria-hidden="true">
                  {handle.valueText}
                </span>
              )}
            </div>
          ))}
          {editingHandle && (
            <HandleEditor
              key={editingHandle.id}
              handle={editingHandle}
              elementRef={(el) => {
                editorElementRef.current = el;
              }}
              onDone={closeEditor}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * How far a press of this pointer type may travel and still be a click
 * (CLICK_SLOP_PX for a mouse, TOUCH_SLOP_PX for a finger or a pen).
 * @param {string | undefined} pointerType
 * @returns {number}
 */
function slopFor(pointerType) {
  return pointerType === "mouse" || !pointerType ? CLICK_SLOP_PX : TOUCH_SLOP_PX;
}

/**
 * The modifier keys of a pointer or keyboard event.
 * @param {{ shiftKey: boolean, altKey: boolean, metaKey: boolean, ctrlKey: boolean }} e
 * @returns {ClickModifiers}
 */
function modifiersOf(e) {
  return {
    shiftKey: Boolean(e?.shiftKey),
    altKey: Boolean(e?.altKey),
    metaKey: Boolean(e?.metaKey),
    ctrlKey: Boolean(e?.ctrlKey),
  };
}

/**
 * The unit directions the screen-space fallback reads travel along: the
 * line itself, or two that span the plane.
 * @param {{ type: string, dir?: Vec3, normal?: Vec3 }} constraint
 * @param {Vec3} handleDir
 * @returns {Vec3[]}
 */
function constraintAxes(constraint, handleDir) {
  const unit = (v) => {
    const n = Math.hypot(v[0], v[1], v[2]);
    return n > 0 ? v.map((c) => c / n) : null;
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  if (constraint.type !== "plane") return [unit(constraint.dir ?? handleDir)].filter(Boolean);
  const n = unit(constraint.normal ?? [0, 0, 1]);
  if (!n) return [];
  const u = unit(cross(n, Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
  return [u, cross(n, u)];
}

// The size box a click (or Enter) on a handle opens: one millimetre field
// with its own draft, so nothing reaches the mode until Enter, or focus
// leaving it, commits what the field shows — Esc cancels, and so does an
// emptied field (DecimalInput reports nothing for one, so its last report
// would be a digit the user has since deleted) or an untouched one. Both
// keys stop here, because the Bench's and Holes' window Escape would drop
// the selection the box belongs to. It is a sibling of the handles, not a child, so the arrow
// keys stepping the field never reach the handle's own key handler.
// `handle` is the one being sized, `elementRef` receives the form for the
// viewer's per-frame placement, `onDone` reports the outcome once: the
// value (null for a cancel) and whether focus should go back to the handle.
/**
 * @param {{
 *   handle: ViewerHandle,
 *   elementRef: (el: HTMLFormElement | null) => void,
 *   onDone: (result: { value: number | null, refocus: boolean }) => void,
 * }} props
 */
function HandleEditor({ handle, elementRef, onDone }) {
  // "" when there is no size to prefill: the field shows empty.
  const [draft, setDraft] = useState(
    /** @type {() => number | ""} */ (
      () => {
        const start = Number.isFinite(handle.editValue) ? handle.editValue : handle.value;
        return Number.isFinite(start) ? start : "";
      }
    ),
  );
  // The text it opened with. The prefill is the measured size rounded to
  // three decimals, so committing it unchanged would not be "no change":
  // the mesh's float size differs from it by a hair, and the parameter
  // would be re-rounded (30.333 → 30.33) with an undo step and a render
  // the user never asked for. A box closed as it opened sets nothing.
  const prefill = useRef(draft === "" ? "" : String(draft));
  const formRef = useRef(null);
  // Set once the box has reported: a cancel unmounts the focused field,
  // and the blur that follows must not commit what Esc threw away.
  const done = useRef(false);
  const finish = (value, refocus) => {
    if (done.current) return;
    done.current = true;
    onDone({ value: typeof value === "number" ? value : null, refocus });
  };
  // The number the field shows, or null when it shows none or still
  // shows the prefill.
  const typed = () => {
    const text = formRef.current?.querySelector("input")?.value ?? "";
    return text === prefill.current ? null : parseDecimal(text);
  };
  useEffect(() => {
    const input = formRef.current?.querySelector("input");
    input?.focus({ preventScroll: true });
    input?.select();
  }, []);
  return (
    <form
      ref={(el) => {
        formRef.current = el;
        elementRef(el);
      }}
      className="viewer-handle-editor"
      onSubmit={(e) => {
        e.preventDefault();
        finish(typed(), true);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" && e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();
        // The repeats of the Enter that opened the box are not a commit.
        if (e.repeat) return;
        finish(e.key === "Enter" ? typed() : null, true);
      }}
      onBlur={(e) => {
        if (formRef.current?.contains(/** @type {Node | null} */ (e.relatedTarget))) return;
        // Switching to another app blurs the field too, mid-number ("1"
        // of "120"); the box stays open and gets its focus back on return.
        if (!document.hasFocus()) return;
        finish(typed(), false);
      }}
    >
      <DecimalInput
        value={draft}
        onChange={setDraft}
        aria-label={handle.editLabel ?? handle.label}
        className="viewer-handle-editor-input"
      />
      <span className="viewer-handle-editor-unit" aria-hidden="true">
        mm
      </span>
    </form>
  );
}

// The viewer toolbar's grid: the uiPrefs.js value every drag and keyboard
// step reads, the same one Settings shows. Blurred after a change — a
// focused select would take the next arrow key (on Windows a closed one
// changes its value) and keep H and F from reaching the viewer.
function GridSelect() {
  const grid = useGridSnap();
  return (
    <select
      className="viewer-tool viewer-grid"
      aria-label="Grid"
      title="The step a dragged or arrow-stepped length snaps to"
      value={String(grid)}
      onChange={(e) => {
        setGridSnap(Number(e.target.value));
        e.target.blur();
      }}
    >
      {GRID_SNAP_OPTIONS.map((mm) => (
        <option key={mm} value={String(mm)}>
          {mm === 0 ? "Grid: Off" : `Grid: ${mm} mm`}
        </option>
      ))}
    </select>
  );
}

// "View ▾": Home, Top, Front and Right in a small menu (a row of four
// buttons would crowd a phone-sized viewer, and two of them are views a
// part is rarely resized from). While it is open its plain keys stop
// there: the Bench's and Holes' window listeners would otherwise act on
// their selection behind it (Esc, which closes the menu, would drop the
// selection too).
// `onPick(name)` sets the view.
/** @param {{ onPick: (name: import("../lib/viewerCamera.js").ViewName) => void }} props */
function ViewMenu({ onPick }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const itemsRef = useRef(/** @type {(HTMLButtonElement | null)[]} */ ([]));

  useEffect(() => {
    if (!open) return undefined;
    itemsRef.current[0]?.focus();
    // A press anywhere else closes it, as a native menu does.
    const onPointerDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  return (
    <span className="viewer-view" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="viewer-tool viewer-view-button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Look from the Home, Top, Front or Right view"
        onClick={() => setOpen((o) => !o)}
      >
        View <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          className="viewer-view-menu"
          role="menu"
          aria-label="View"
          onKeyDown={(e) => {
            const items = itemsRef.current.filter(Boolean);
            const at = items.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
            if (e.key === "Escape") close();
            else if (e.key === "ArrowDown") items[(at + 1) % items.length]?.focus();
            else if (e.key === "ArrowUp") items[(at - 1 + items.length) % items.length]?.focus();
            else if (e.key === "Home") items[0]?.focus();
            else if (e.key === "End") items[items.length - 1]?.focus();
            else if (e.key === "Tab") {
              setOpen(false);
              return;
            } else {
              // The rest of the plain keys are the menu's too while it is
              // open: to the Bench's and Holes' window listeners a menu
              // item is just a button, and ArrowLeft/Right, Delete or M
              // would nudge, delete or move their selection behind it. Not
              // cancelled, so Enter and Space still pick the item; Cmd/Ctrl
              // shortcuts (undo) go on as anywhere.
              if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
              return;
            }
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {VIEW_PRESETS.map((preset, i) => (
            <button
              key={preset.id}
              ref={(el) => {
                itemsRef.current[i] = el;
              }}
              type="button"
              role="menuitem"
              className="viewer-view-item"
              onClick={() => {
                onPick(preset.id);
                close();
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

// Four corner brackets: "frame what's there".
function FitIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// An eye, struck through while the helpers are hidden.
/** @param {{ closed: boolean }} props */
function EyeIcon({ closed }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
      {closed && <path d="M2.5 13.5l11-11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
    </svg>
  );
}

function disposeHighlight(scene) {
  const previous = scene.getObjectByName("highlight");
  if (!previous) return;
  scene.remove(previous);
  previous.geometry.dispose();
  previous.material.dispose();
}

function disposeModel(scene) {
  const previous = scene.getObjectByName("model");
  if (!previous) return;
  scene.remove(previous);
  if (previous.userData.ownsGeometry) previous.geometry.dispose();
  previous.material.dispose();
}

function disposeGuides(scene) {
  const previous = scene.getObjectByName("guides");
  if (!previous) return;
  scene.remove(previous);
  for (const lines of previous.children) {
    lines.geometry.dispose();
    lines.material.dispose();
  }
}

// Everything the markers effect reads from a marker, as one string, so
// two lists that would build the same spheres compare equal whatever
// objects they arrive in. `hitTest` takes part too: it decides whether
// a sphere answers to the raycaster, so a change there has to rebuild.
function markersKey(markers) {
  if (!markers || !markers.length) return "";
  return markers
    .map((m) =>
      [
        m.id,
        m.x,
        m.y,
        m.z,
        m.radius,
        m.color,
        m.shape,
        m.normal ? m.normal.join(",") : "",
        m.hitTest === false ? 0 : 1,
      ].join("|"),
    )
    .join("\n");
}

// The same for guides: the Holes tab hands over a new array on every
// render while Option is held, nearly always the same lines.
function guidesKey(guides) {
  if (!guides || !guides.length) return "";
  return guides.map((g) => [g.a.join(","), g.b.join(","), g.color, g.dashed ? 1 : 0].join("|")).join("\n");
}

function highlightKey(box) {
  return box ? `${box.min.join(",")}/${box.max.join(",")}` : "";
}

function disposeMarkers(scene) {
  const previous = scene.getObjectByName("markers");
  if (!previous) return;
  scene.remove(previous);
  disposeMarkerGroup(previous);
}

function disposeMarkerGroup(group) {
  for (const marker of group.children) marker.material.dispose();
  for (const geom of group.userData.geometries ?? []) geom.dispose();
}
