// Collapse/expand control shared by Library's and the Bench's own
// sidebar — same `[` shortcut either way (see App.jsx's keydown
// handler), so the button's tooltip stays truthful regardless of which
// screen it's rendered in.
export default function SidebarToggle({ collapsed, onToggle }) {
  return (
    <button
      type="button"
      className="sidebar-toggle"
      onClick={onToggle}
      title={collapsed ? "Expand sidebar ([)" : "Collapse sidebar ([)"}
    >
      {collapsed ? "»" : "«"}
    </button>
  );
}
