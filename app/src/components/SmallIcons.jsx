import React from "react";

// Minimal monoline icons using currentColor, so they pick up the neon theme
// (and its red boot-state variant) instead of rendering as flat-color OS
// emoji that clash with the blue-on-black look.
const base = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  className: "icon-glow",
};

export function IconAttach(props) {
  return (
    <svg {...base} {...props}>
      <path d="M21.44 11.05 12.25 20.24a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95L9.64 17.5a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export function IconCamera(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="14" r="3.5" />
    </svg>
  );
}

export function IconHistory(props) {
  return (
    <svg {...base} {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v4h4" />
      <path d="M12 8v4l3 2" />
    </svg>
  );
}

export function IconUpload(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 15V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

export function IconCheck(props) {
  return (
    <svg {...base} strokeWidth={2.6} {...props}>
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

export function IconTrash(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7" />
      <path d="M6 7l1 13a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 17 20l1-13" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function IconRepeat(props) {
  return (
    <svg {...base} {...props}>
      <path d="M17 2.5l3.5 3.5L17 9.5" />
      <path d="M20.5 6H8a5 5 0 0 0-5 5v1" />
      <path d="M7 21.5L3.5 18 7 14.5" />
      <path d="M3.5 18H16a5 5 0 0 0 5-5v-1" />
    </svg>
  );
}

export function IconMic(props) {
  return (
    <svg {...base} strokeWidth={1.8} {...props}>
      <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" stroke="none" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
      <path d="M8 22h8" />
    </svg>
  );
}
