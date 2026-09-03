// Collapse/expand control shared by Library's and the Bench's own
// sidebar — same `[` shortcut either way (see App.jsx's keydown
// handler), so the button's tooltip stays truthful regardless of which
// screen it's rendered in. The chevron is the desktop face (the sidebar
// is a column there); on a narrow screen the sidebar stacks above the
// workspace, so the text label shows instead (styles.css swaps them).
export default function SidebarToggle({ collapsed, onToggle }) {
  const label = collapsed ? "Show sidebar" : "Hide sidebar";
  return (
    <button
      type="button"
      className="sidebar-toggle"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={label}
      title={`${label} ([)`}
    >
      <span className="sidebar-toggle-chevron" aria-hidden="true">
        {collapsed ? "»" : "«"}
      </span>
      <span className="sidebar-toggle-text">{label}</span>
    </button>
  );
}
