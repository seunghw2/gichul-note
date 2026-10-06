const s = (body: string, size = 20, extra = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" ${extra} aria-hidden="true">${body}</svg>`;

const bmPath = '<path d="M6 3h12v18l-6-4.5L6 21z"/>';

export const I = {
  back: s('<path d="M15 18l-6-6 6-6"/>', 22),
  close: s('<path d="M6 6l12 12M18 6L6 18"/>', 22),
  play: s('<path d="M8 5.5v13l10.5-6.5z"/>', 20, 'fill="currentColor"'),
  redo: s('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  book: s('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/><path d="M9 8h6"/>'),
  bm: s(bmPath, 18),
  bmOn: s(bmPath, 18, 'fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"'),
  pg: s('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/>', 14),
  search: s('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 18),
  arrowL: s('<path d="M19 12H5M11 6l-6 6 6 6"/>', 16),
  arrowR: s('<path d="M5 12h14M13 6l6 6-6 6"/>', 16),
  check: s('<path d="M5 12.5l4.5 4.5L19 7"/>', 18, 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"'),
  x: s('<path d="M6 6l12 12M18 6L6 18"/>', 18, 'fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"'),
};
