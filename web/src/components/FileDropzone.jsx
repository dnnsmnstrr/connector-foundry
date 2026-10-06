import { useRef, useState } from "react";

// A file picker that is also a drop target: a dashed panel with an icon
// and a line of text, which opens the native chooser on click and takes
// a file dragged onto it. The real <input type="file"> is still there,
// stretched invisibly over the whole panel — so a click anywhere on it
// is a plain click on the input (no JS needed to open the chooser),
// Tab lands on it (the panel shows the focus ring via :focus-within),
// screen readers get a labelled file input, and a test can still find
// and click `input[type=file]`. Drops are handled on the panel: the
// default is prevented so the browser doesn't navigate to the file.
//
// `onFile(file)` gets the chosen or dropped File; the input is cleared
// after each pick so the same file can be chosen again after a failed
// attempt. `accept` is the input's own accept list; it is not enforced
// on a drop (the caller's reader decides what it can open).
export default function FileDropzone({ accept, onFile, label, hint, className }) {
  const inputRef = useRef(null);
  // Nested dragenter/dragleave pairs fire as the pointer crosses the
  // panel's children; a counter keeps the highlight on until the last
  // leave.
  const depth = useRef(0);
  const [over, setOver] = useState(false);

  function take(file) {
    if (file) onFile(file);
  }

  function onChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    take(file);
  }

  function onDragEnter(event) {
    event.preventDefault();
    depth.current += 1;
    setOver(true);
  }

  function onDragOver(event) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  function onDragLeave(event) {
    event.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  }

  function onDrop(event) {
    event.preventDefault();
    depth.current = 0;
    setOver(false);
    take(event.dataTransfer?.files?.[0]);
  }

  const classes = ["dropzone", over ? "is-over" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <div className={classes} onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <input ref={inputRef} type="file" accept={accept} className="dropzone-input" aria-label={label} onChange={onChange} />
      <svg className="dropzone-icon" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 16V5m0 0 4 4m-4-4-4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
        />
      </svg>
      <span className="dropzone-label">{over ? "Drop to import" : label}</span>
      {hint && <span className="dropzone-hint">{hint}</span>}
    </div>
  );
}
