// A small drawn gear keeps Settings recognizable without relying on a
// platform-specific emoji glyph.
export default function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9.7 2.9h4.6l.5 2.2a7.4 7.4 0 0 1 1.5.9l2.1-.8 2.3 4-1.6 1.5a7.5 7.5 0 0 1 0 1.8l1.6 1.5-2.3 4-2.1-.8a7.4 7.4 0 0 1-1.5.9l-.5 2.2H9.7l-.5-2.2a7.4 7.4 0 0 1-1.5-.9l-2.1.8-2.3-4 1.6-1.5a7.5 7.5 0 0 1 0-1.8L3.3 9.2l2.3-4 2.1.8a7.4 7.4 0 0 1 1.5-.9z" />
      <circle cx="12" cy="11.6" r="3.1" />
    </svg>
  );
}
