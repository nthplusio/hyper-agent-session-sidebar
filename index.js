const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// Development logging - set to true to enable file logging
const DEV_LOGGING = true;

// Utils module path for hot-reloading
const UTILS_PATH = path.join(__dirname, 'utils.js');
const CLAUDE_DETECTION_PATH = path.join(__dirname, 'claude-detection.js');

// Helper to get fresh claude detection module (supports hot-reload)
const getClaudeDetection = () => {
  if (DEV_LOGGING) {
    delete require.cache[require.resolve(CLAUDE_DETECTION_PATH)];
  }
  return require(CLAUDE_DETECTION_PATH);
};

// Helper to get fresh utils (supports hot-reload)
const getUtils = () => {
  if (DEV_LOGGING) {
    // Clear cache and re-require for hot-reload
    delete require.cache[require.resolve(UTILS_PATH)];
  }
  return require(UTILS_PATH);
};
const LOG_FILE = path.join(__dirname, 'debug.log');

const log = (...args) => {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`;

  if (DEV_LOGGING) {
    fs.appendFileSync(LOG_FILE, message + '\n');
  }
  console.log('[hyper-session-sidebar]', ...args);
};

// Store session data
const sessions = {};
let activeUid = null;
let initialized = false;
let pollInterval = null;

// Default configuration - these are fallbacks, actual colors come from Hyper theme
const defaultConfig = {
  width: 220,
  position: 'left', // 'left' or 'right'
  showGit: true,
  showCwd: true,
  showShellLauncher: true,
  showPid: true,
  activityTimeout: 3000, // ms to show activity indicator
  opacity: 0.9,
  opacityHover: 1,
  // Activity detection options
  enableClaudeDetection: true,   // Auto-detect Claude Code sessions
  claudeIdleTimeout: 5000,       // ms before working -> waiting transition
  showActivityGlyph: true,       // Show activity glyph (dot/icon)
  // Theme colors - if not set, will be derived from Hyper's theme
  theme: {
    // These will be populated from Hyper config if not overridden
  }
};

// Resolved theme colors (populated in decorateConfig, with fallback defaults)
let themeColors = {
  background: '#1e1e2e',
  foreground: '#cdd6f4',
  border: '#313244',
  surfaceDark: '#11111b',
  surface0: '#1e1e2e',
  surface1: '#313244',
  surface2: '#45475a',
  blue: '#89b4fa',
  green: '#a6e3a1',
  red: '#f38ba8',
  yellow: '#f9e2af',
  magenta: '#f5c2e7',
  cyan: '#94e2d5',
  orange: '#fab387',
  subtext: '#a6adc8',
  overlay: '#6c7086',
};

// Color manipulation helpers
const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
};

const rgbToHex = (r, g, b) => {
  return '#' + [r, g, b].map(x => {
    const hex = Math.max(0, Math.min(255, Math.round(x))).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
};

const darkenColor = (hex, amount) => {
  if (!hex) return null;
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return rgbToHex(rgb.r * (1 - amount), rgb.g * (1 - amount), rgb.b * (1 - amount));
};

const lightenColor = (hex, amount) => {
  if (!hex) return null;
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return rgbToHex(
    rgb.r + (255 - rgb.r) * amount,
    rgb.g + (255 - rgb.g) * amount,
    rgb.b + (255 - rgb.b) * amount
  );
};

// Merged config (will be set from decorateConfig)
let pluginConfig = { ...defaultConfig };

// Store configured shells (read from hyper config)
let configuredShells = [];

// Store keymap prefix for shell shortcuts (e.g., 'ctrl+shift')
let shellKeymapPrefix = '';

// Get current working directory for a session
const getCwd = (uid, pid, callback) => {
  if (!pid) {
    if (callback) callback();
    return;
  }

  if (process.platform === 'win32') {
    // Windows: CWD detection is handled via terminal output parsing
    if (callback) callback();
  } else {
    // Unix: Use lsof
    exec(`lsof -p ${pid} | awk '$4=="cwd"' | tr -s ' ' | cut -d ' ' -f9-`, (err, stdout) => {
      if (!err && sessions[uid]) {
        sessions[uid].cwd = stdout.trim();
        getGitInfo(uid, sessions[uid].cwd);
      }
      if (callback) callback();
    });
  }
};

// =============================================================================
// CWD DETECTION PATTERNS
// Each pattern has: name, regex, transform (optional), skipIf (optional)
// Patterns are tried in order - first match wins
// =============================================================================
const cwdPatterns = [
  {
    name: 'OSC 7',
    description: 'Standard terminal CWD escape sequence',
    regex: /\x1b\]7;file:\/\/[^\/]*([^\x07\x1b]+)(?:\x07|\x1b\\)/,
    transform: (match) => {
      let path = decodeURIComponent(match);
      // Convert Unix path to Windows if needed (e.g., /c/Users -> C:\Users)
      if (path.match(/^\/[a-z]\//i)) {
        path = path[1].toUpperCase() + ':' + path.slice(2).replace(/\//g, '\\');
      }
      return path;
    }
  },
  {
    name: 'OSC 9;9',
    description: 'Windows Terminal style CWD escape sequence',
    regex: /\x1b\]9;9;([^\x07\x1b]+)(?:\x07|\x1b\\)/,
  },
  {
    name: 'MINGW',
    description: 'Git Bash MINGW prompt with path',
    regex: /MINGW\d*\s+(\/[a-z](?:\/[^\s\r\n$]*)?)/i,
    transform: (match) => {
      const drive = match[1].toUpperCase();
      return drive + ':' + (match.slice(2) || '\\').replace(/\//g, '\\');
    }
  },
  {
    name: 'PS Prompt',
    description: 'Standard PowerShell "PS path>" prompt',
    regex: /PS\s+([A-Za-z]:\\[^\r\n>]+)>/,
  },
  {
    name: 'CMD Prompt',
    description: 'Standard CMD "path>" prompt',
    regex: /^([A-Za-z]:\\[^\r\n>]*)>/m,
    skipIf: (path) => /\\windows\\|\\system32\\|\\program files/i.test(path),
  },
  {
    name: 'Directory Output',
    description: 'PowerShell dir/Get-ChildItem "Directory:" output',
    regex: /Directory:\s*([A-Za-z]:\\[^\r\n\x1b]+)/,
  },
  {
    name: 'Tilde Prompt',
    description: 'Custom prompt with ~ path (Oh My Posh, Starship, etc.)',
    regex: /\x1b\[\d*m\s*(~(?:[\\\/][^\s\r\n\x1b❯>$#]*)?)\s*\x1b/,
    transform: (match) => {
      const homePath = process.env.USERPROFILE || process.env.HOME || '';
      let path = match === '~' ? homePath : match.replace(/^~/, homePath);
      return path.replace(/\//g, '\\');
    }
  },
  {
    name: 'Full Windows Path',
    description: 'Full Windows path in colored prompt',
    regex: /\x1b\[\d*m\s*([A-Za-z]:\\[^\s\r\n\x1b❯>$#]*)/,
    skipIf: (path) => /\\windows\\|\\system32\\|\\program files/i.test(path),
  },
  {
    name: 'Unix Path',
    description: 'Git Bash Unix-style path (/c/path)',
    regex: /(?:^|[\s\x1b\[\]0-9;m]+)(\/[a-z]\/[^\s\r\n\x1b❯>$#]*)/im,
    transform: (match) => {
      const drive = match[1].toUpperCase();
      return drive + ':' + (match.slice(2) || '\\').replace(/\//g, '\\');
    }
  },
];

// Try to extract CWD from terminal data using registered patterns
const extractCwd = (data) => {
  for (const pattern of cwdPatterns) {
    const match = data.match(pattern.regex);
    if (match) {
      let path = match[1].trim();

      // Apply transform if defined
      if (pattern.transform) {
        path = pattern.transform(path);
      }

      // Check skip condition
      if (pattern.skipIf && pattern.skipIf(path)) {
        continue;
      }

      return { path, patternName: pattern.name };
    }
  }
  return null;
};

// Parse terminal output for CWD and activity patterns
const parseTerminalOutput = (uid, data) => {
  if (!sessions[uid]) return;

  const now = Date.now();
  const session = sessions[uid];

  // Only log meaningful output (skip single characters which are typically keystrokes)
  if (data.length > 5) {
    const preview = data.substring(0, 150).replace(/[\r\n]/g, '\\n').replace(/\x1b/g, '<ESC>');
    log('parseTerminalOutput:', { uid: uid.substring(0, 8), len: data.length, preview });
  }

  // Store last output chunk for debugging/future pattern matching
  session.lastOutput = data;

  // =========================================================================
  // ACTIVITY DETECTION - Track output patterns to determine activity type
  // =========================================================================

  // Calculate time since last output for intensity tracking
  const timeSinceLastOutput = session.lastOutputTime ? now - session.lastOutputTime : Infinity;

  // Determine activity type based on output characteristics
  if (data.length > 5) {
    // Significant output (not just single keystrokes)

    // Track burst rate for intensity calculation
    if (timeSinceLastOutput < 100) {
      // Rapid output (< 100ms apart) = likely command running
      session.outputBurstCount = Math.min((session.outputBurstCount || 0) + 1, 100);
      session.activityType = 'command';
      session.activityIntensity = Math.min(session.outputBurstCount * 5, 100);
    } else if (timeSinceLastOutput < 1000) {
      // Normal output rate
      session.outputBurstCount = Math.max((session.outputBurstCount || 0) - 1, 0);
      session.activityType = 'output';
      session.activityIntensity = Math.max(30, session.activityIntensity - 5);
    } else {
      // Fresh output after pause
      session.outputBurstCount = 1;
      session.activityType = 'output';
      session.activityIntensity = 30;
    }

    session.lastOutputTime = now;

    // Mark activity for non-active sessions
    if (uid !== activeUid) {
      markActivity(uid);
    }
  } else if (data.length > 0 && data.length <= 5) {
    // Single characters - likely user typing
    session.activityType = 'typing';
    session.activityIntensity = Math.max(10, (session.activityIntensity || 0) - 2);
  }

  // =========================================================================
  // CWD DETECTION
  // =========================================================================

  // Try to extract CWD using pattern matching
  const result = extractCwd(data);
  if (result && result.path && result.path !== session.cwd) {
    log(`CWD detected [${result.patternName}]:`, result.path);
    session.cwd = result.path;
    getGitInfo(uid, result.path);
  }

  // =========================================================================
  // CLAUDE CODE DETECTION
  // =========================================================================

  if (pluginConfig.enableClaudeDetection !== false) {
    const claudeDetection = getClaudeDetection();

    // Update Claude detection state
    const wasUpdated = claudeDetection.updateClaudeDetection(session, data, now);

    if (wasUpdated && session.claudeDetected) {
      log('Claude state:', {
        uid: uid.substring(0, 8),
        state: session.claudeState,
        spinnerPhase: session.claudeSpinnerPhase
      });
    }

    // Also check for legacy claude-code detection pattern
    if (!session.claudeDetected && /claude[- ]?code|anthropic/i.test(data)) {
      session.detectedActivity = 'claude-code';
      session.claudeDetected = true;
      session.claudeState = 'idle';
      session.claudeLastActivity = now;
      log('Activity detected: claude-code (legacy pattern)');
    }
  }
};

// Get git information for a directory (debounced per session)
const gitDebounce = {};
const getGitInfo = (uid, cwd) => {
  if (!cwd || !sessions[uid] || !pluginConfig.showGit) return;

  // Debounce git checks per session
  if (gitDebounce[uid]) {
    clearTimeout(gitDebounce[uid]);
  }

  gitDebounce[uid] = setTimeout(() => {
    const nullDevice = process.platform === 'win32' ? 'nul' : '/dev/null';

    // Check if it's a git repo
    exec(`git rev-parse --is-inside-work-tree 2>${nullDevice}`, { cwd }, (err) => {
      if (err) {
        if (sessions[uid]) {
          sessions[uid].git = { branch: '', dirty: 0 };
        }
        return;
      }

      // Get branch name
      exec(`git symbolic-ref --short HEAD 2>${nullDevice} || git rev-parse --short HEAD 2>${nullDevice}`, { cwd }, (err, stdout) => {
        if (!err && sessions[uid]) {
          sessions[uid].git.branch = stdout.trim();
        }
      });

      // Get dirty status
      exec(`git status --porcelain --ignore-submodules -uno 2>${nullDevice}`, { cwd }, (err, stdout) => {
        if (!err && sessions[uid]) {
          sessions[uid].git.dirty = stdout.trim() ? stdout.trim().split('\n').length : 0;
        }
      });
    });
  }, 500); // 500ms debounce
};

// Display utility functions are in utils.js for hot-reload support
// Use getUtils() to get fresh versions when DEV_LOGGING is enabled

// Mark session as having activity
const markActivity = (uid) => {
  if (!sessions[uid] || uid === activeUid) return;

  sessions[uid].hasActivity = true;
  sessions[uid].activityTime = Date.now();
};

// Clear old activity indicators and decay intensity
const clearOldActivity = () => {
  const now = Date.now();
  Object.keys(sessions).forEach((uid) => {
    const session = sessions[uid];

    // Clear hasActivity flag after timeout
    if (session.hasActivity && session.activityTime) {
      if (now - session.activityTime > pluginConfig.activityTimeout) {
        session.hasActivity = false;
      }
    }

    // Decay activity intensity over time
    const timeSinceOutput = session.lastOutputTime ? now - session.lastOutputTime : Infinity;
    if (timeSinceOutput > 2000) {
      // No output for 2+ seconds - decay intensity
      session.activityIntensity = Math.max(0, (session.activityIntensity || 0) - 10);
      session.outputBurstCount = Math.max(0, (session.outputBurstCount || 0) - 5);

      if (session.activityIntensity === 0 && session.activityType !== 'idle') {
        session.activityType = 'idle';
      }
    }

    // Handle Claude state transitions (working -> waiting after idle timeout)
    if (session.claudeDetected && session.claudeState === 'working') {
      const claudeIdleTimeout = pluginConfig.claudeIdleTimeout || 5000;
      const timeSinceClaudeActivity = session.claudeLastActivity ? now - session.claudeLastActivity : Infinity;

      if (timeSinceClaudeActivity > claudeIdleTimeout) {
        session.claudeState = 'waiting';
        session.claudeLastStateChange = now;
        log('Claude state transition: working -> waiting (idle timeout)', { uid: uid.substring(0, 8) });
      }
    }
  });
};

// Generate CSS based on config and theme colors
const generateCSS = (config) => {
  const pos = config.position === 'right' ? 'right' : 'left';
  const otherPos = pos === 'left' ? 'right' : 'left';
  const t = themeColors; // shorthand

  return `
  /* ═══════════════════════════════════════════════════════════════
     HYPER SESSION SIDEBAR
     Theme-aware styling - colors derived from Hyper config
     ═══════════════════════════════════════════════════════════════ */

  .session-sidebar {
    position: fixed;
    top: 38px;
    ${pos}: 0;
    bottom: 0;
    width: ${config.width}px;
    background: ${t.surfaceDark};
    border-${otherPos}: 1px solid ${t.border};
    overflow-y: auto;
    overflow-x: hidden;
    z-index: 100;
    opacity: ${config.opacity};
    transition: opacity 0.15s ease;
    font-family: "FiraCode Nerd Font", "Fira Code NF", Consolas, monospace;
    font-size: 11px;
    font-variant-ligatures: none;
    -webkit-font-feature-settings: "liga" 0;
    font-feature-settings: "liga" 0;
  }
  .session-sidebar:hover {
    opacity: ${config.opacityHover};
  }

  /* Header */
  .session-sidebar-header {
    padding: 10px 12px;
    color: ${t.foreground};
    font-weight: 700;
    font-size: 10px;
    letter-spacing: 1px;
    text-transform: uppercase;
    border-bottom: 1px solid ${t.border};
    background: ${t.surfaceDark};
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .session-header-count {
    background: ${t.blue};
    color: ${t.surfaceDark};
    font-size: 9px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 8px;
    min-width: 16px;
    text-align: center;
  }
  .session-header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .session-refresh-btn {
    background: transparent;
    border: none;
    color: ${t.subtext};
    cursor: pointer;
    padding: 2px 4px;
    font-size: 12px;
    line-height: 1;
    border-radius: 4px;
    transition: all 0.15s ease;
    font-family: "FiraCode Nerd Font", "Fira Code NF", Consolas, monospace;
  }
  .session-refresh-btn:hover {
    color: ${t.foreground};
    background: ${t.surface1};
  }

  /* Session Cards */
  .session-item {
    position: relative;
    padding: 8px 10px 8px 12px;
    margin: 4px 6px;
    border-radius: 6px;
    background: ${t.surface1}50;
    cursor: pointer;
    transition: all 0.15s ease;
    border-left: 3px solid transparent;
  }
  .session-item:hover {
    background: ${t.surface1}90;
  }
  .session-item.active {
    background: ${t.surface1};
    border-left-color: ${t.blue};
  }
  .session-item.has-activity {
    border-left-color: ${t.magenta};
    animation: activity-bg 1.5s ease-in-out infinite;
  }
  @keyframes activity-bg {
    0%, 100% { background: ${t.surface1}50; }
    50% { background: ${t.magenta}15; }
  }

  /* Session Header Row */
  .session-header-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }
  .session-shell-icon {
    font-size: 14px;
    flex-shrink: 0;
    width: 16px;
  }
  .session-title {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
  }
  .session-process-name {
    color: ${t.foreground};
    font-weight: 600;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .session-index {
    font-size: 9px;
    font-weight: 600;
    color: ${t.subtext};
    background: ${t.surface2}80;
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .session-item.active .session-index {
    color: ${t.foreground};
    background: ${t.blue}40;
  }
  .session-activity-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${t.magenta};
    flex-shrink: 0;
    animation: dot-pulse 1s ease-in-out infinite;
  }
  @keyframes dot-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* ═══════════════════════════════════════════════════════════════
     ACTIVITY GLYPHS - Visual indicators for session state
     ═══════════════════════════════════════════════════════════════ */

  /* Base glyph styles - colored dot for standard terminals */
  .activity-glyph {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-left: auto;
  }

  /* Standard terminal states */
  .activity-glyph.running {
    background: ${t.green};
    animation: glyph-pulse 1s ease-in-out infinite;
    box-shadow: 0 0 4px ${t.green}80;
  }
  .activity-glyph.has-output {
    background: ${t.cyan};
    animation: glyph-fade 2s ease-out;
  }
  .activity-glyph.inactive {
    background: ${t.overlay};
    opacity: 0.4;
  }

  /* Claude glyph - uses icon instead of dot */
  .activity-glyph.claude {
    width: auto;
    height: auto;
    background: none !important;
    font-size: 12px;
    line-height: 1;
    border-radius: 0;
    box-shadow: none;
  }
  .activity-glyph.claude.working {
    color: ${t.green};
    animation: glyph-pulse 1s ease-in-out infinite;
    text-shadow: 0 0 6px ${t.green}80;
  }
  .activity-glyph.claude.thinking {
    color: ${t.magenta};
    animation: glyph-pulse-slow 2s ease-in-out infinite;
    text-shadow: 0 0 6px ${t.magenta}60;
  }
  .activity-glyph.claude.waiting {
    color: ${t.yellow};
    text-shadow: 0 0 4px ${t.yellow}40;
  }
  .activity-glyph.claude.idle {
    color: ${t.overlay};
    opacity: 0.5;
  }

  /* Glyph animations */
  @keyframes glyph-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(0.9); }
  }
  @keyframes glyph-pulse-slow {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.85); }
  }
  @keyframes glyph-fade {
    0% { opacity: 1; }
    100% { opacity: 0.5; }
  }

  /* Activity intensity bar (optional) */
  .activity-intensity-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    height: 2px;
    background: linear-gradient(90deg, ${t.green}, ${t.cyan});
    border-radius: 0 0 0 6px;
    transition: width 0.3s ease;
    opacity: 0.7;
  }

  /* Session Details */
  .session-details {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-left: 22px;
  }
  .session-detail-row {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    color: ${t.foreground};
    opacity: 0.7;
  }
  .session-item.active .session-detail-row {
    opacity: 0.85;
  }
  .session-detail-icon {
    width: 12px;
    flex-shrink: 0;
  }
  .session-detail-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  /* CWD styling */
  .session-cwd .session-detail-icon {
    color: ${t.blue};
  }

  /* Git styling */
  .session-git {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
  }
  .session-git-icon {
    color: ${t.orange};
    width: 12px;
    flex-shrink: 0;
  }
  .session-git-branch {
    color: ${t.green};
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .session-git-stats {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    flex-shrink: 0;
  }
  .session-git-dirty {
    color: ${t.red};
    font-size: 9px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .session-git-clean {
    color: ${t.green};
    font-size: 9px;
  }

  /* Status bar */
  .session-status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid ${t.surface2}60;
  }
  .session-timestamp {
    font-size: 9px;
    color: ${t.subtext};
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .session-pid {
    font-size: 9px;
    color: ${t.subtext};
    opacity: 0.8;
  }

  /* Empty State */
  .session-empty {
    padding: 24px 12px;
    color: ${t.subtext};
    text-align: center;
  }
  .session-empty-icon {
    font-size: 24px;
    margin-bottom: 8px;
    opacity: 0.6;
  }

  /* Quick Launch Bar */
  .shell-quicklaunch {
    display: flex;
    gap: 4px;
    padding: 8px;
    background: ${t.surfaceDark};
    border-bottom: 1px solid ${t.border};
  }
  .shell-quicklaunch-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 6px 4px;
    border-radius: 6px;
    background: ${t.surface1}80;
    border: 1px solid transparent;
    color: ${t.foreground};
    cursor: pointer;
    font-size: 10px;
    font-family: inherit;
    transition: all 0.15s ease;
  }
  .shell-quicklaunch-btn:hover {
    background: ${t.surface2};
    border-color: ${t.blue}40;
  }
  .shell-quicklaunch-btn:active {
    background: ${t.surface1};
  }
  .shell-quicklaunch-btn-icon {
    font-size: 16px;
    flex-shrink: 0;
    min-width: 16px;
    text-align: center;
  }
  .shell-quicklaunch-btn-label {
    font-size: 8px;
    color: ${t.subtext};
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  /* Scrollbar */
  .session-sidebar::-webkit-scrollbar {
    width: 6px;
  }
  .session-sidebar::-webkit-scrollbar-track {
    background: transparent;
  }
  .session-sidebar::-webkit-scrollbar-thumb {
    background: ${t.surface2};
    border-radius: 3px;
  }
  .session-sidebar::-webkit-scrollbar-thumb:hover {
    background: ${t.overlay};
  }

  /* Terminal Area Adjustment */
  .terms_terms {
    margin-${pos}: ${config.width}px !important;
  }
  .header_header {
    padding-${pos}: ${config.width}px !important;
  }
`;
};

// Decorate config to add CSS and read user config
exports.decorateConfig = (config) => {
  // Merge user config with defaults
  const userConfig = config.sessionSidebar || {};
  pluginConfig = { ...defaultConfig, ...userConfig };

  // Read configured shells and keymap prefix from config
  configuredShells = config.shells || [];
  shellKeymapPrefix = config.selectShellKeymap || '';

  // Store shells in pluginConfig so it's available in the renderer
  pluginConfig.shells = configuredShells;
  pluginConfig.shellKeymapPrefix = shellKeymapPrefix;

  // Derive theme colors from Hyper's config, with user overrides
  const userTheme = userConfig.theme || {};
  const colors = config.colors || {};

  themeColors = {
    // Base colors from Hyper theme
    background: userTheme.background || config.backgroundColor || '#1e1e2e',
    foreground: userTheme.foreground || config.foregroundColor || '#cdd6f4',
    border: userTheme.border || config.borderColor || '#313244',

    // Surface colors (derived from background)
    surfaceDark: userTheme.surfaceDark || darkenColor(config.backgroundColor, 0.3) || '#11111b',
    surface0: userTheme.surface0 || config.backgroundColor || '#1e1e2e',
    surface1: userTheme.surface1 || lightenColor(config.backgroundColor, 0.1) || '#313244',
    surface2: userTheme.surface2 || lightenColor(config.backgroundColor, 0.2) || '#45475a',

    // Accent colors from Hyper's color palette
    blue: userTheme.blue || colors.blue || '#89b4fa',
    green: userTheme.green || colors.green || '#a6e3a1',
    red: userTheme.red || colors.red || '#f38ba8',
    yellow: userTheme.yellow || colors.yellow || '#f9e2af',
    magenta: userTheme.magenta || colors.magenta || '#f5c2e7',
    cyan: userTheme.cyan || colors.cyan || '#94e2d5',
    orange: userTheme.orange || colors.lightRed || '#fab387',

    // Muted colors
    subtext: userTheme.subtext || '#a6adc8',
    overlay: userTheme.overlay || '#6c7086',
  };

  // Log only once to avoid flooding (decorateConfig is called frequently)
  if (!exports._decorateConfigLogged) {
    exports._decorateConfigLogged = true;
    log('decorateConfig', { shellCount: configuredShells.length, shellKeymapPrefix, showShellLauncher: pluginConfig.showShellLauncher });
  }

  // Store original shell getter if any
  const originalShellDescriptor = Object.getOwnPropertyDescriptor(config, 'shell');
  const originalShellArgsDescriptor = Object.getOwnPropertyDescriptor(config, 'shellArgs');

  const newConfig = Object.assign({}, config, {
    css: `
      ${config.css || ''}
      ${generateCSS(pluginConfig)}
    `
  });

  // Override shell getters to check pendingShell first
  Object.defineProperties(newConfig, {
    shell: {
      get: () => {
        if (pendingShell && pendingShell.shell) {
          return pendingShell.shell;
        }
        if (originalShellDescriptor && originalShellDescriptor.get) {
          return originalShellDescriptor.get();
        }
        return config.shell;
      },
      configurable: true
    },
    shellArgs: {
      get: () => {
        if (pendingShell && pendingShell.args) {
          const args = pendingShell.args;
          pendingShell = null; // Clear after using
          return args;
        }
        if (originalShellArgsDescriptor && originalShellArgsDescriptor.get) {
          return originalShellArgsDescriptor.get();
        }
        return config.shellArgs;
      },
      configurable: true
    }
  });

  return newConfig;
};

// Redux middleware to track sessions and activity
let middlewareInitialized = false;
exports.middleware = (store) => {
  if (!middlewareInitialized) {
    middlewareInitialized = true;
    log('middleware INITIALIZED');
  }
  return (next) => (action) => {
    // Only log important session actions (not the frequent data ones)
    if (action.type && action.type.startsWith('SESSION') &&
        !['SESSION_ADD_DATA', 'SESSION_USER_DATA', 'SESSION_PTY_DATA'].includes(action.type)) {
      log('middleware action:', action.type);
    }

    switch (action.type) {
    case 'SESSION_ADD':
      log('SESSION_ADD full action:', JSON.stringify(action, null, 2));
      log('SESSION_ADD', { uid: action.uid, pid: action.pid, shell: action.shell });
      sessions[action.uid] = {
        uid: action.uid,
        pid: action.pid,
        shell: action.shell,
        title: '',
        cwd: '',
        git: { branch: '', dirty: 0 },
        hasActivity: false,
        activityTime: null,
        lastOutput: '',
        detectedActivity: null,
        // Activity tracking fields
        activityType: 'idle',        // 'idle' | 'output' | 'typing' | 'command'
        activityIntensity: 0,        // 0-100 for visual intensity
        lastOutputTime: null,
        outputBurstCount: 0,
        // Claude Code detection fields
        claudeDetected: false,
        claudeState: null,           // 'working' | 'thinking' | 'waiting' | 'idle'
        claudeSpinnerPhase: null,
        claudeLastActivity: null,
        claudeLastStateChange: null,
      };
      getCwd(action.uid, action.pid);
      break;

    case 'SESSION_SET_XTERM_TITLE':
      if (sessions[action.uid]) {
        sessions[action.uid].title = action.title;
      }
      break;

    case 'SESSION_ADD_DATA':
      // SESSION_ADD_DATA doesn't have a uid - we need to get it from the store
      // Use the active session's uid since terminal output goes to the active session
      {
        const state = store.getState();
        const currentActiveUid = state.sessions.activeUid;
        const storeSessions = state.sessions.sessions || {};

        // Only log larger data chunks to reduce noise
        if (action.data && action.data.length > 20) {
          log('SESSION_ADD_DATA:', {
            activeUid: currentActiveUid ? currentActiveUid.substring(0, 8) : 'NONE',
            dataLen: action.data.length
          });
        }

        // Initialize session if it doesn't exist in our tracking
        if (currentActiveUid && !sessions[currentActiveUid] && storeSessions[currentActiveUid]) {
          const storeSession = storeSessions[currentActiveUid];
          log('SESSION_ADD_DATA: creating session from store', currentActiveUid.substring(0, 8));
          sessions[currentActiveUid] = {
            uid: currentActiveUid,
            pid: storeSession.pid,
            shell: storeSession.shell,
            title: storeSession.title || '',
            cwd: '',
            git: { branch: '', dirty: 0 },
            hasActivity: false,
            activityTime: null,
            lastOutput: '',
            detectedActivity: null,
            // Activity tracking fields
            activityType: 'idle',
            activityIntensity: 0,
            lastOutputTime: null,
            outputBurstCount: 0,
            // Claude Code detection fields
            claudeDetected: false,
            claudeState: null,
            claudeSpinnerPhase: null,
            claudeLastActivity: null,
            claudeLastStateChange: null,
          };
        }

        // Parse terminal output for CWD and activity patterns
        if (currentActiveUid && action.data && sessions[currentActiveUid]) {
          parseTerminalOutput(currentActiveUid, action.data);
        }
      }
      break;

    case 'SESSION_SET_ACTIVE':
      log('SESSION_SET_ACTIVE', { uid: action.uid });
      activeUid = action.uid;
      // Clear activity when session becomes active
      if (sessions[action.uid]) {
        sessions[action.uid].hasActivity = false;
        getCwd(action.uid, sessions[action.uid].pid);
      }
      break;

    case 'SESSION_PTY_EXIT':
      log('SESSION_PTY_EXIT', { uid: action.uid });
      if (gitDebounce[action.uid]) {
        clearTimeout(gitDebounce[action.uid]);
        delete gitDebounce[action.uid];
      }
      delete sessions[action.uid];
      break;
  }

    return next(action);
  };
};

// Store pending shell for next tab
let pendingShell = null;

// Handle window events for custom shell launching
exports.onWindow = (browserWindow) => {
  log('onWindow initialized');
  browserWindow.rpc.on('sidebar open shell tab', (shellConfig) => {
    log('Opening shell tab', shellConfig);
    // Store the shell config for the next session
    pendingShell = shellConfig;
    // Request a new terminal group
    browserWindow.rpc.emit('termgroup add req');
  });
};

// Add keyboard shortcuts for shells
exports.decorateKeymaps = (keymaps) => {
  if (!shellKeymapPrefix || configuredShells.length === 0) {
    return keymaps;
  }

  const shellKeymaps = {};
  configuredShells.forEach((shell, index) => {
    if (shell.shortcut) {
      const accelerator = `${shellKeymapPrefix}+${shell.shortcut}`;
      shellKeymaps[accelerator] = `sidebar:shell:${index}`;
    }
  });

  return Object.assign({}, keymaps, shellKeymaps);
};

// Map keyboard shortcuts to dispatched actions
exports.mapTermsDispatch = (dispatch, map) => {
  const shellDispatchers = {};

  configuredShells.forEach((shell, index) => {
    if (shell.shortcut) {
      shellDispatchers[`sidebar:shell:${index}`] = () => {
        if (window.rpc) {
          window.rpc.emit('sidebar open shell tab', {
            shell: shell.shell,
            args: shell.args || []
          });
        }
      };
    }
  });

  return Object.assign({}, map, shellDispatchers);
};

// Intercept session creation to use pending shell
exports.getTermProps = (uid, parentProps, props) => {
  if (pendingShell) {
    const shellToUse = { ...pendingShell };
    pendingShell = null;
    return Object.assign({}, props, {
      shell: shellToUse.shell,
      shellArgs: shellToUse.args || []
    });
  }
  return props;
};

// Cleanup on plugin unload
exports.onUnload = (app) => {
  log('onUnload - cleaning up');

  // Clear the poll interval
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  // Clear all git debounce timeouts
  Object.keys(gitDebounce).forEach((uid) => {
    clearTimeout(gitDebounce[uid]);
    delete gitDebounce[uid];
  });

  // Reset state
  Object.keys(sessions).forEach((uid) => delete sessions[uid]);
  activeUid = null;
  initialized = false;
};

// Decorate Hyper to add sidebar
exports.decorateHyper = (Hyper, { React }) => {
  return class extends React.Component {
    constructor(props) {
      super(props);
      this.state = {
        sessions: {},
        activeUid: null
      };
    }

    componentDidMount() {
      log('componentDidMount - sidebar initialized');

      // Poll for session updates
      pollInterval = setInterval(() => {
        if (!window.store) {
          return;
        }

        try {
          const state = window.store.getState();
          if (!state || !state.sessions) {
            return;
          }

          const storeSessions = state.sessions.sessions || {};
          const currentActiveUid = state.sessions.activeUid;
          activeUid = currentActiveUid;

          // Sync our sessions object with the store
          Object.keys(storeSessions).forEach((uid) => {
            const storeSession = storeSessions[uid];
            if (!sessions[uid]) {
              // New session - initialize it
              sessions[uid] = {
                uid: uid,
                pid: storeSession.pid,
                shell: storeSession.shell,
                title: storeSession.title || '',
                cwd: '',
                git: { branch: '', dirty: 0 },
                hasActivity: false,
                activityTime: null,
                lastOutput: '',
                detectedActivity: null,
                // Activity tracking fields
                activityType: 'idle',
                activityIntensity: 0,
                lastOutputTime: null,
                outputBurstCount: 0,
                // Claude Code detection fields
                claudeDetected: false,
                claudeState: null,
                claudeSpinnerPhase: null,
                claudeLastActivity: null,
                claudeLastStateChange: null,
              };
              getCwd(uid, storeSession.pid);
            } else {
              // Update title from store
              sessions[uid].title = storeSession.title || sessions[uid].title;
              sessions[uid].pid = storeSession.pid;
            }
          });

          // Remove sessions that no longer exist
          Object.keys(sessions).forEach((uid) => {
            if (!storeSessions[uid]) {
              delete sessions[uid];
            }
          });

          // Clear old activity indicators
          clearOldActivity();

          this.setState({
            sessions: { ...sessions },
            activeUid: currentActiveUid
          });
        } catch (e) {
          console.error('[hyper-session-sidebar] Error:', e);
        }
      }, 500);
    }

    componentWillUnmount() {
      log('componentWillUnmount');
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    }

    handleSessionClick(uid) {
      log('handleSessionClick', { uid });
      if (window.store) {
        window.store.dispatch({
          type: 'SESSION_SET_ACTIVE',
          uid
        });
      }
    }

    handleRefresh() {
      log('handleRefresh - forcing sidebar refresh with hot-reload');

      // Clear utils cache for hot-reload
      try {
        delete require.cache[require.resolve(UTILS_PATH)];
        log('Utils cache cleared successfully');
      } catch (e) {
        log('Error clearing utils cache:', e.message);
      }

      // Clear claude detection cache for hot-reload
      try {
        delete require.cache[require.resolve(CLAUDE_DETECTION_PATH)];
        log('Claude detection cache cleared successfully');
      } catch (e) {
        log('Error clearing claude detection cache:', e.message);
      }

      // Deep clone sessions to ensure React sees it as new data
      const freshSessions = {};
      Object.keys(sessions).forEach((uid) => {
        freshSessions[uid] = { ...sessions[uid], git: { ...sessions[uid].git } };
      });

      // Increment refresh counter to force re-render
      const newCounter = (this.state._refreshCounter || 0) + 1;

      log('Refresh: updating state', {
        sessionCount: Object.keys(freshSessions).length,
        refreshCounter: newCounter
      });

      // Force component re-render with new state object
      this.setState({
        sessions: freshSessions,
        activeUid: activeUid,
        _refreshCounter: newCounter
      }, () => {
        log('Refresh: setState callback fired, render should have occurred');
      });
    }

    openShellTab(shell) {
      log('openShellTab', { name: shell.name, shell: shell.shell });
      // Use window.rpc to request a new terminal with the specific shell
      if (window.rpc) {
        // Emit our custom event that will set the pending shell and open tab
        window.rpc.emit('sidebar open shell tab', {
          shell: shell.shell,
          args: shell.args || []
        });
      }
    }

    getShellIconForLauncher(shell) {
      const utils = getUtils();
      return utils.getShellIconForLauncher(shell);
    }

    renderShellQuickLaunch() {
      // Get shells from window.config (renderer process has access to this)
      const shells = (window.config && window.config.getConfig && window.config.getConfig().shells) || [];
      const keymapPrefix = (window.config && window.config.getConfig && window.config.getConfig().selectShellKeymap) || '';
      const sidebarConfig = (window.config && window.config.getConfig && window.config.getConfig().sessionSidebar) || {};
      const showLauncher = sidebarConfig.showShellLauncher !== false;

      if (!showLauncher || shells.length === 0) {
        return null;
      }

      return React.createElement(
        'div',
        { className: 'shell-quicklaunch' },
        shells.map((shell, index) => {
          const iconInfo = this.getShellIconForLauncher(shell);
          // Get short label (first word or abbreviation)
          const shortLabel = shell.name.split(' ')[0];
          const shortcutHint = keymapPrefix && shell.shortcut ? ` (${keymapPrefix}+${shell.shortcut})` : '';
          return React.createElement(
            'button',
            {
              key: index,
              className: 'shell-quicklaunch-btn',
              onClick: () => this.openShellTab(shell),
              title: `Open new ${shell.name} tab${shortcutHint}`
            },
            React.createElement('span', {
              className: 'shell-quicklaunch-btn-icon',
              style: { color: iconInfo.color }
            }, iconInfo.icon),
            React.createElement('span', {
              className: 'shell-quicklaunch-btn-label'
            }, shortLabel)
          );
        })
      );
    }

    renderSession(uid, data, index) {
      let utils;
      try {
        utils = getUtils();
      } catch (e) {
        // Fallback if utils fails to load
        utils = {
          getProcessName: () => 'shell',
          shortenPath: (p) => p || '',
          getShellInfo: () => ({ icon: '\uf489', color: '#89b4fa' }),
          extractPathFromTitle: (t) => t || '',
          getActivityGlyph: () => ({ icon: null, className: 'activity-glyph inactive', title: 'Inactive', style: {} }),
        };
      }
      const isActive = uid === this.state.activeUid;
      const hasActivity = data.hasActivity && !isActive;

      // Use CWD if available, otherwise try to extract from title
      const effectiveCwd = data.cwd || utils.extractPathFromTitle(data.title);
      const processName = utils.getProcessName(data);
      const shortCwd = utils.shortenPath(effectiveCwd);
      const shellInfo = utils.getShellInfo(data);

      // Get activity glyph info (dot for standard, icon for Claude)
      const activityGlyph = utils.getActivityGlyph ? utils.getActivityGlyph(data) : null;
      const showActivityGlyph = pluginConfig.showActivityGlyph !== false;

      // Determine status text based on activity type and Claude state
      let statusText = isActive ? 'active' : 'idle';
      if (data.claudeDetected && data.claudeState) {
        statusText = `Claude: ${data.claudeState}`;
      } else if (data.activityType && data.activityType !== 'idle') {
        statusText = data.activityType;
      }

      let className = 'session-item';
      if (isActive) className += ' active';
      if (hasActivity) className += ' has-activity';
      if (data.claudeDetected) className += ' claude-session';

      // Build session card with new structure
      return React.createElement(
        'div',
        {
          key: uid,
          className: className,
          onClick: () => this.handleSessionClick(uid)
        },
        // Header row: Icon + Name + Activity Glyph + Index
        React.createElement(
          'div',
          { className: 'session-header-row' },
          React.createElement('span', {
            className: 'session-shell-icon',
            style: { color: shellInfo.color }
          }, shellInfo.icon),
          React.createElement(
            'div',
            { className: 'session-title' },
            React.createElement('span', { className: 'session-process-name' }, processName),
            // Legacy activity dot for backward compatibility
            hasActivity && !showActivityGlyph && React.createElement('span', { className: 'session-activity-dot' }),
            // New activity glyph
            showActivityGlyph && activityGlyph && React.createElement(
              'span',
              {
                className: activityGlyph.className,
                style: activityGlyph.style,
                title: activityGlyph.title
              },
              activityGlyph.icon  // null for dots (CSS renders them), icon text for Claude
            )
          ),
          React.createElement('span', { className: 'session-index' }, index + 1)
        ),
        // Details section
        React.createElement(
          'div',
          { className: 'session-details' },
          // CWD row (uses effectiveCwd which falls back to title-extracted path)
          pluginConfig.showCwd && effectiveCwd && React.createElement(
            'div',
            { className: 'session-detail-row session-cwd', title: effectiveCwd },
            React.createElement('span', { className: 'session-detail-icon' }, '\uf07b'),
            React.createElement('span', { className: 'session-detail-text' }, shortCwd)
          ),
          // Git row
          pluginConfig.showGit && React.createElement(
            'div',
            { className: 'session-detail-row session-git' },
            React.createElement('span', { className: 'session-git-icon' }, '\ue725'),
            data.git && data.git.branch
              ? React.createElement(
                  React.Fragment,
                  null,
                  React.createElement('span', { className: 'session-git-branch' }, data.git.branch),
                  React.createElement(
                    'span',
                    { className: 'session-git-stats' },
                    data.git.dirty > 0
                      ? React.createElement('span', { className: 'session-git-dirty' }, '\uf040', ` ${data.git.dirty}`)
                      : React.createElement('span', { className: 'session-git-clean' }, '\uf00c')
                  )
                )
              : React.createElement('span', { style: { color: '#585b70', fontStyle: 'italic' } }, 'no repo')
          ),
          // Status bar with PID and activity status
          React.createElement(
            'div',
            { className: 'session-status-bar' },
            React.createElement(
              'span',
              { className: 'session-timestamp' },
              '\uf4bc ',
              statusText
            ),
            React.createElement('span', { className: 'session-pid' }, `PID ${data.pid}`)
          )
        ),
        // Activity intensity bar (for active sessions)
        data.activityIntensity > 0 && React.createElement('div', {
          className: 'activity-intensity-bar',
          style: { width: `${data.activityIntensity}%` }
        })
      );
    }

    render() {
      const sessionList = Object.entries(this.state.sessions);

      const sidebar = React.createElement(
        'div',
        { className: 'session-sidebar' },
        // Header with count badge and optional refresh button
        React.createElement(
          'div',
          { className: 'session-sidebar-header' },
          React.createElement('span', null, 'Sessions'),
          React.createElement(
            'div',
            { className: 'session-header-actions' },
            DEV_LOGGING && React.createElement(
              'button',
              {
                className: 'session-refresh-btn',
                onClick: () => this.handleRefresh(),
                title: 'Refresh sidebar (dev mode)'
              },
              '\ueb37' // Codicon sync icon (nf-cod-sync)
            ),
            React.createElement('span', { className: 'session-header-count' }, sessionList.length)
          )
        ),
        this.renderShellQuickLaunch(),
        sessionList.length === 0
          ? React.createElement(
              'div',
              { className: 'session-empty' },
              React.createElement('div', { className: 'session-empty-icon' }, '\uf489'),
              'No active sessions'
            )
          : sessionList.map(([uid, data], index) => this.renderSession(uid, data, index))
      );

      const existingChildren = this.props.customChildren
        ? (Array.isArray(this.props.customChildren) ? this.props.customChildren : [this.props.customChildren])
        : [];

      return React.createElement(Hyper, Object.assign({}, this.props, {
        customChildren: existingChildren.concat(sidebar)
      }));
    }
  };
};
