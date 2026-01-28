// Icon library for hyper-session-sidebar
// Based on Lucide icons (https://lucide.dev) - MIT License
// All icons are 24x24 viewBox, stroke-based

const ICONS = {
  // Terminal/Shell icons
  terminal: {
    path: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
    label: 'Terminal'
  },
  'terminal-square': {
    path: '<path d="m7 11 2-2-2-2"/><line x1="11" y1="13" x2="15" y2="13"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>',
    label: 'Terminal Square'
  },
  console: {
    path: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m6 8 4 4-4 4"/><line x1="12" y1="16" x2="18" y2="16"/>',
    label: 'Console'
  },
  'square-terminal': {
    path: '<path d="m7 11 2-2-2-2"/><line x1="11" y1="13" x2="15" y2="13"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>',
    label: 'Square Terminal'
  },

  // Code/Dev icons
  code: {
    path: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    label: 'Code'
  },
  'file-code': {
    path: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/>',
    label: 'File Code'
  },
  braces: {
    path: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
    label: 'Braces'
  },

  // Git icons
  'git-branch': {
    path: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    label: 'Git Branch'
  },
  'git-commit': {
    path: '<circle cx="12" cy="12" r="3"/><line x1="3" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="21" y2="12"/>',
    label: 'Git Commit'
  },
  'git-merge': {
    path: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
    label: 'Git Merge'
  },

  // Folder/File icons
  folder: {
    path: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
    label: 'Folder'
  },
  'folder-open': {
    path: '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
    label: 'Folder Open'
  },
  file: {
    path: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/>',
    label: 'File'
  },

  // Status/Activity icons
  activity: {
    path: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    label: 'Activity'
  },
  zap: {
    path: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    label: 'Zap'
  },
  loader: {
    path: '<line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>',
    label: 'Loader'
  },
  circle: {
    path: '<circle cx="12" cy="12" r="10"/>',
    label: 'Circle'
  },
  'circle-dot': {
    path: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
    label: 'Circle Dot'
  },

  // AI/Robot icons
  bot: {
    path: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
    label: 'Bot'
  },
  cpu: {
    path: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
    label: 'CPU'
  },
  sparkles: {
    path: '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>',
    label: 'Sparkles'
  },

  // Language/Runtime icons
  hexagon: {
    path: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>',
    label: 'Hexagon'
  },
  gem: {
    path: '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>',
    label: 'Gem'
  },

  // Misc
  play: {
    path: '<polygon points="5 3 19 12 5 21 5 3"/>',
    label: 'Play'
  },
  pause: {
    path: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
    label: 'Pause'
  },
  square: {
    path: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>',
    label: 'Square'
  },
  check: {
    path: '<polyline points="20 6 9 17 4 12"/>',
    label: 'Check'
  },
  x: {
    path: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    label: 'X'
  },
  'alert-circle': {
    path: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    label: 'Alert Circle'
  },
  'check-circle': {
    path: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    label: 'Check Circle'
  },
  clock: {
    path: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    label: 'Clock'
  },
  hash: {
    path: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
    label: 'Hash'
  },
  settings: {
    path: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    label: 'Settings'
  },
};

// Default SVG attributes
const SVG_DEFAULTS = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '2',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

/**
 * Get SVG markup for an icon
 * @param {string} name - Icon name
 * @param {number} size - Icon size in pixels
 * @param {object} attrs - Additional SVG attributes
 * @returns {string} SVG markup
 */
function getIconSvg(name, size = 16, attrs = {}) {
  const icon = ICONS[name];
  if (!icon) {
    console.warn(`[icons] Unknown icon: ${name}`);
    return '';
  }

  const mergedAttrs = {
    ...SVG_DEFAULTS,
    width: size,
    height: size,
    ...attrs,
  };

  const attrString = Object.entries(mergedAttrs)
    .map(([k, v]) => {
      // Convert camelCase to kebab-case for SVG attributes
      const key = k.replace(/([A-Z])/g, '-$1').toLowerCase();
      return `${key}="${v}"`;
    })
    .join(' ');

  return `<svg ${attrString}>${icon.path}</svg>`;
}

/**
 * Get list of available icon names
 * @returns {string[]}
 */
function getIconNames() {
  return Object.keys(ICONS);
}

/**
 * Check if an icon exists
 * @param {string} name
 * @returns {boolean}
 */
function hasIcon(name) {
  return name in ICONS;
}

module.exports = {
  ICONS,
  SVG_DEFAULTS,
  getIconSvg,
  getIconNames,
  hasIcon,
};
