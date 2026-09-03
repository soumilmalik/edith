import React from "react";

// Consistent line-art icon set (stroke = currentColor, no fill) so every tab
// icon renders identically across platforms - mixing plain Unicode glyphs
// and emoji-capable characters (e.g. a stopwatch glyph vs a plain dingbat)
// made iOS render some in full color and others as flat system-font glyphs,
// which read as mismatched.
const common = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export function ChatIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M4 5.5h16a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H9l-4.5 4V16H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z" />
      <circle cx="8.5" cy="10.75" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="10.75" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="10.75" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CalendarIcon(props) {
  return (
    <svg {...common} {...props}>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2" />
    </svg>
  );
}

export function HealthIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M12 20.2s-7.4-4.6-9.8-9.4C.8 7.4 2.7 4 6.2 4c2 0 3.5 1.1 4.3 2.6.3.6 1.2.6 1.5 0C12.8 5.1 14.3 4 16.3 4c3.5 0 5.4 3.4 4 6.8-2.4 4.8-9.8 9.4-9.8 9.4Z" />
      <path d="M4.5 11.5h3l1.5-3 2 6 1.5-3h4.2" />
    </svg>
  );
}

export function TimerIcon(props) {
  return (
    <svg {...common} {...props}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.6 2.6M9.5 2.5h5M12 4.5V2.5" />
    </svg>
  );
}

export function TaskIcon(props) {
  return (
    <svg {...common} {...props}>
      <path d="M4.5 6.5l1.5 1.5 2.5-2.5" />
      <path d="M11 6.5h9" />
      <path d="M4.5 12.5l1.5 1.5 2.5-2.5" />
      <path d="M11 12.5h9" />
      <path d="M4.5 18.5l1.5 1.5 2.5-2.5" />
      <path d="M11 18.5h9" />
    </svg>
  );
}

export function ProfileIcon(props) {
  return (
    <svg {...common} {...props}>
      <circle cx="12" cy="8.2" r="3.4" />
      <path d="M4.8 20c1-3.6 4-5.5 7.2-5.5s6.2 1.9 7.2 5.5" />
    </svg>
  );
}
