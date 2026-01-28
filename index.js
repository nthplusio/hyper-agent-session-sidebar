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

// Performance: Polling intervals based on window visibility
const POLL_INTERVAL_ACTIVE = 500;    // ms when window is visible
const POLL_INTERVAL_HIDDEN = 2000;   // ms when window is hidden
let currentPollInterval = POLL_INTERVAL_ACTIVE;

// Performance: Track visible sessions for lazy git fetching
const visibleSessions = new Set();

// Default configuration - these are fallbacks, actual colors come from Hyper theme
const defaultConfig = {
  width: 220,
  position: 'left', // 'left' or 'right'
  showGit: true,
  showCwd: true,
  showShellLauncher: true,
  showPid: true,
  activityTimeout: 1500, // ms to show activity indicator
  opacity: 0.9,
  opacityHover: 1,
  // View mode: 'default' | 'compact' | 'micro'
  viewMode: 'compact',
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
// Each pattern has: name, priority (higher = more reliable), regex, transform, skipIf
// Patterns are scored by priority - highest priority match wins
// =============================================================================
const cwdPatterns = [
  {
    name: 'OSC 7',
    description: 'Standard terminal CWD escape sequence',
    priority: 100,  // Most reliable - explicit CWD reporting
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
    priority: 98,  // Very reliable - WT specific
    regex: /\x1b\]9;9;([^\x07\x1b]+)(?:\x07|\x1b\\)/,
  },
  {
    name: 'ConPTY',
    description: 'Windows Terminal ConPTY quoted path',
    priority: 97,  // Very reliable - ConPTY specific
    regex: /\x1b\]9;9;"([^"]+)"\x1b\\/,
  },
  {
    name: 'MINGW',
    description: 'Git Bash MINGW prompt with path',
    priority: 85,  // Reliable - explicit in title/prompt
    regex: /MINGW\d*\s+(\/[a-z](?:\/[^\s\r\n$]*)?)/i,
    transform: (match) => {
      const drive = match[1].toUpperCase();
      return drive + ':' + (match.slice(2) || '\\').replace(/\//g, '\\');
    }
  },
  {
    name: 'PS Prompt',
    description: 'Standard PowerShell "PS path>" prompt',
    priority: 70,  // Good - standard PS prompt format
    regex: /PS\s+([A-Za-z]:\\[^\r\n>]+)>/,
  },
  {
    name: 'Directory Output',
    description: 'PowerShell dir/Get-ChildItem "Directory:" output',
    priority: 65,  // Good - explicit directory label
    regex: /Directory:\s*([A-Za-z]:\\[^\r\n\x1b]+)/,
  },
  {
    name: 'CMD Prompt',
    description: 'Standard CMD "path>" prompt',
    priority: 60,  // Moderate - common but can have false positives
    regex: /^([A-Za-z]:\\[^\r\n>]*)>/m,
    skipIf: (path) => /\\windows\\|\\system32\\|\\program files/i.test(path),
  },
  {
    name: 'Tilde Prompt',
    description: 'Custom prompt with ~ path (Oh My Posh, Starship, etc.)',
    priority: 55,  // Moderate - needs home expansion
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
    priority: 40,  // Lower - generic pattern, more false positives
    regex: /\x1b\[\d*m\s*([A-Za-z]:\\[^\s\r\n\x1b❯>$#]*)/,
    skipIf: (path) => /\\windows\\|\\system32\\|\\program files/i.test(path),
  },
  {
    name: 'Unix Path',
    description: 'Git Bash Unix-style path (/c/path)',
    priority: 35,  // Lower - can match partial paths
    regex: /(?:^|[\s\x1b\[\]0-9;m]+)(\/[a-z]\/[^\s\r\n\x1b❯>$#]*)/im,
    transform: (match) => {
      const drive = match[1].toUpperCase();
      return drive + ':' + (match.slice(2) || '\\').replace(/\//g, '\\');
    }
  },
];

// Pre-compile regex patterns for performance
const compiledCwdPatterns = cwdPatterns.map(p => ({
  ...p,
  compiled: new RegExp(p.regex.source, p.regex.flags)
}));

// =============================================================================
// OUTPUT TYPE PATTERNS - Detect error/warning/success for color-coded indicators
// =============================================================================
const OUTPUT_PATTERNS = {
  error: {
    patterns: [
      /\b(error|failed|failure|exception|fatal|denied|refused|cannot|unable)\b/i,
      /\bERR[!:]/,
      /\x1b\[31m/,  // Red ANSI
      /\x1b\[91m/,  // Bright red ANSI
    ],
    color: 'error'
  },
  warning: {
    patterns: [
      /\b(warn|warning|deprecated|caution)\b/i,
      /\bWARN[!:]/,
      /\x1b\[33m/,  // Yellow ANSI
      /\x1b\[93m/,  // Bright yellow ANSI
    ],
    color: 'warning'
  },
  success: {
    patterns: [
      /\b(success|succeeded|passed|complete|completed|done|ok)\b/i,
      /\x1b\[32m/,  // Green ANSI
      /\x1b\[92m/,  // Bright green ANSI
      /✓|✔|√/,
    ],
    color: 'success'
  },
  progress: {
    patterns: [
      /\d+%/,
      /\[\s*[=>#-]+\s*\]/,  // Progress bars
      /\.{3,}/,  // Ellipsis (loading...)
    ],
    color: 'progress'
  }
};

// Detect output type from terminal data
const detectOutputType = (data) => {
  for (const [type, config] of Object.entries(OUTPUT_PATTERNS)) {
    for (const pattern of config.patterns) {
      if (pattern.test(data)) {
        return type;
      }
    }
  }
  return null;
};

// Activity burst detection threshold (ms)
const BURST_THRESHOLD = 250;  // Wider than before (was effectively 100ms)

// Try to extract CWD from terminal data using priority-scored patterns
const extractCwd = (data) => {
  // Collect all matches with their priorities
  const matches = [];

  for (const pattern of compiledCwdPatterns) {
    const match = data.match(pattern.compiled);
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

      matches.push({
        path,
        patternName: pattern.name,
        priority: pattern.priority
      });
    }
  }

  // Return highest priority match
  if (matches.length > 0) {
    matches.sort((a, b) => b.priority - a.priority);
    return matches[0];
  }

  return null;
};

// Output buffering for CWD detection (prompts often arrive in chunks)
const cwdBuffers = {};
const cwdBufferTimeouts = {};
const CWD_BUFFER_TIMEOUT = 150;  // ms to wait for complete prompt

// Process buffered output for CWD extraction
const processCwdBuffer = (uid) => {
  if (!sessions[uid] || !cwdBuffers[uid]) return;

  const bufferedData = cwdBuffers[uid];
  cwdBuffers[uid] = '';

  const result = extractCwd(bufferedData);
  if (result && result.path && result.path !== sessions[uid].cwd) {
    log(`CWD detected [${result.patternName}] (priority ${result.priority || 'n/a'}):`, result.path);
    sessions[uid].cwd = result.path;
    getGitInfo(uid, result.path);
  }
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

  // Detect output type for color-coded indicators
  const outputType = data.length > 5 ? detectOutputType(data) : null;
  if (outputType) {
    session.lastOutputType = outputType;
    session.lastOutputTypeTime = now;
  }

  // Determine activity type based on output characteristics
  if (data.length > 5) {
    // Significant output (not just single keystrokes)

    // Track burst rate for intensity calculation (wider threshold)
    if (timeSinceLastOutput < BURST_THRESHOLD) {
      // Rapid output = likely command running
      session.outputBurstCount = Math.min((session.outputBurstCount || 0) + 1, 100);
      session.activityType = 'command';
      session.activityIntensity = Math.min(session.outputBurstCount * 4, 100);
    } else if (timeSinceLastOutput < 1000) {
      // Normal output rate
      session.outputBurstCount = Math.max((session.outputBurstCount || 0) - 1, 0);
      session.activityType = 'output';
      // Boost intensity slightly instead of just maintaining
      session.activityIntensity = Math.min(50, (session.activityIntensity || 0) + 10);
    } else {
      // Fresh output after pause
      session.outputBurstCount = 1;
      session.activityType = 'output';
      session.activityIntensity = 35;
    }

    session.lastOutputTime = now;

    // Mark activity for non-active sessions
    if (uid !== activeUid) {
      markActivity(uid);
    }
  } else if (data.length > 0 && data.length <= 5) {
    // Single characters - likely user typing
    session.activityType = 'typing';
    // Slight decay for typing
    session.activityIntensity = Math.max(10, (session.activityIntensity || 0) * 0.95);
  }

  // =========================================================================
  // CWD DETECTION (buffered for multi-chunk prompts)
  // =========================================================================

  // Buffer output and debounce CWD extraction
  cwdBuffers[uid] = (cwdBuffers[uid] || '') + data;

  // Limit buffer size to prevent memory issues (keep last 4KB)
  if (cwdBuffers[uid].length > 4096) {
    cwdBuffers[uid] = cwdBuffers[uid].slice(-4096);
  }

  // Debounce CWD extraction to allow prompt chunks to arrive
  if (cwdBufferTimeouts[uid]) {
    clearTimeout(cwdBufferTimeouts[uid]);
  }
  cwdBufferTimeouts[uid] = setTimeout(() => processCwdBuffer(uid), CWD_BUFFER_TIMEOUT);

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

// Get git information for a directory (debounced per session, lazy for non-visible)
const gitDebounce = {};
const getGitInfo = (uid, cwd, forceVisible = false) => {
  if (!cwd || !sessions[uid] || !pluginConfig.showGit) return;

  // Performance: Skip git fetch for non-visible sessions unless forced
  // (IntersectionObserver will trigger fetch when they become visible)
  if (!forceVisible && visibleSessions.size > 0 && !visibleSessions.has(uid)) {
    // Mark that git info is pending for when session becomes visible
    sessions[uid]._pendingGitFetch = true;
    return;
  }

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

// Clear old activity indicators and decay intensity (exponential decay)
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

    // Clear output type indicator after 3 seconds
    if (session.lastOutputType && session.lastOutputTypeTime) {
      if (now - session.lastOutputTypeTime > 3000) {
        session.lastOutputType = null;
      }
    }

    // Exponential decay of activity intensity over time
    const timeSinceOutput = session.lastOutputTime ? now - session.lastOutputTime : Infinity;
    if (timeSinceOutput > 1500) {
      // No output for 1.5+ seconds - exponential decay (feels more natural)
      session.activityIntensity = Math.max(0, (session.activityIntensity || 0) * 0.85);
      session.outputBurstCount = Math.max(0, Math.floor((session.outputBurstCount || 0) * 0.8));

      // Threshold to snap to zero and set idle
      if (session.activityIntensity < 3) {
        session.activityIntensity = 0;
        if (session.activityType !== 'idle') {
          session.activityType = 'idle';
        }
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
     ACTIVITY GLYPHS - Star indicators for session state
     ═══════════════════════════════════════════════════════════════ */

  /* Base glyph styles - star icon for all sessions */
  .activity-glyph {
    flex-shrink: 0;
    margin-left: auto;
    font-size: 12px;
    line-height: 1;
  }

  /* Standard terminal states (star icon) */
  .activity-glyph.star.running {
    color: ${t.green};
    animation: glyph-pulse 1s ease-in-out infinite;
    text-shadow: 0 0 6px ${t.green}80;
  }
  .activity-glyph.star.has-output {
    color: ${t.cyan};
    animation: glyph-fade 2s ease-out;
    text-shadow: 0 0 4px ${t.cyan}60;
  }
  .activity-glyph.star.inactive {
    color: ${t.overlay};
    opacity: 0.4;
  }

  /* Claude/AI assistant glyph states */
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

  /* ═══════════════════════════════════════════════════════════════
     OUTPUT TYPE INDICATORS - Color-coded based on output content
     ═══════════════════════════════════════════════════════════════ */

  /* Error output - red glow */
  .activity-glyph.output-error {
    color: ${t.red} !important;
    text-shadow: 0 0 6px ${t.red}80, 0 0 2px ${t.red};
    animation: glyph-pulse 0.8s ease-in-out infinite;
  }
  .session-item.output-error {
    border-left-color: ${t.red} !important;
  }
  .session-item.output-error .activity-intensity-bar {
    background: linear-gradient(90deg, ${t.red}, ${t.orange});
  }

  /* Warning output - yellow/amber glow */
  .activity-glyph.output-warning {
    color: ${t.yellow} !important;
    text-shadow: 0 0 5px ${t.yellow}70;
    animation: glyph-pulse 1s ease-in-out infinite;
  }
  .session-item.output-warning {
    border-left-color: ${t.yellow} !important;
  }
  .session-item.output-warning .activity-intensity-bar {
    background: linear-gradient(90deg, ${t.yellow}, ${t.orange});
  }

  /* Success output - green glow */
  .activity-glyph.output-success {
    color: ${t.green} !important;
    text-shadow: 0 0 5px ${t.green}70;
  }
  .session-item.output-success {
    border-left-color: ${t.green} !important;
  }
  .session-item.output-success .activity-intensity-bar {
    background: linear-gradient(90deg, ${t.green}, ${t.cyan});
  }

  /* Progress output - cyan pulse */
  .activity-glyph.output-progress {
    color: ${t.cyan} !important;
    text-shadow: 0 0 4px ${t.cyan}60;
    animation: glyph-pulse 1.2s ease-in-out infinite;
  }
  .session-item.output-progress {
    border-left-color: ${t.cyan} !important;
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

  /* View Mode Toggle Button */
  .session-viewmode-btn {
    background: transparent;
    border: none;
    color: ${t.subtext};
    cursor: pointer;
    padding: 2px 4px;
    font-size: 10px;
    line-height: 1;
    border-radius: 4px;
    transition: all 0.15s ease;
    font-family: "FiraCode Nerd Font", "Fira Code NF", Consolas, monospace;
  }
  .session-viewmode-btn:hover {
    color: ${t.foreground};
    background: ${t.surface1};
  }

  /* ═══════════════════════════════════════════════════════════════
     COMPACT VIEW MODE - Two-row condensed cards (~40px)
     ═══════════════════════════════════════════════════════════════ */

  .session-sidebar[data-view="compact"] .session-item {
    padding: 6px 8px 6px 10px;
    margin: 2px 4px;
    border-left-width: 2px;
  }
  .session-sidebar[data-view="compact"] .session-header-row {
    margin-bottom: 2px;
    gap: 4px;
  }
  .session-sidebar[data-view="compact"] .session-shell-icon {
    font-size: 12px;
    width: 14px;
  }
  .session-sidebar[data-view="compact"] .session-process-name {
    font-size: 10px;
  }
  .session-sidebar[data-view="compact"] .session-index {
    font-size: 8px;
    padding: 1px 4px;
  }
  .session-sidebar[data-view="compact"] .session-details {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 2px 10px;
    margin-left: 18px;
  }
  .session-sidebar[data-view="compact"] .session-detail-row {
    font-size: 9px;
  }
  .session-sidebar[data-view="compact"] .session-git {
    font-size: 9px;
  }
  .session-sidebar[data-view="compact"] .session-status-bar {
    display: none;
  }
  .session-sidebar[data-view="compact"] .activity-glyph {
    font-size: 10px;
  }
  .session-sidebar[data-view="compact"] .activity-intensity-bar {
    height: 1px;
  }

  /* ═══════════════════════════════════════════════════════════════
     MICRO VIEW MODE - Icon-only with hover expand (~28px)
     ═══════════════════════════════════════════════════════════════ */

  .session-sidebar[data-view="micro"] .session-item {
    padding: 4px 6px;
    margin: 1px 3px;
    border-left-width: 2px;
    position: relative;
  }
  .session-sidebar[data-view="micro"] .session-header-row {
    margin-bottom: 0;
    gap: 4px;
  }
  .session-sidebar[data-view="micro"] .session-shell-icon {
    font-size: 11px;
    width: 12px;
  }
  .session-sidebar[data-view="micro"] .session-title {
    gap: 4px;
  }
  .session-sidebar[data-view="micro"] .session-process-name {
    font-size: 9px;
    max-width: 80px;
  }
  .session-sidebar[data-view="micro"] .session-index {
    font-size: 7px;
    padding: 0px 3px;
  }
  .session-sidebar[data-view="micro"] .session-details {
    display: none;
    position: absolute;
    left: calc(100% + 4px);
    top: 0;
    background: ${t.surface1};
    border: 1px solid ${t.border};
    border-radius: 6px;
    padding: 8px 10px;
    min-width: 160px;
    z-index: 200;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    flex-direction: column;
    gap: 4px;
    margin-left: 0;
  }
  .session-sidebar[data-view="micro"] .session-item:hover .session-details {
    display: flex;
  }
  .session-sidebar[data-view="micro"] .session-status-bar {
    display: none;
  }
  .session-sidebar[data-view="micro"] .session-item:hover .session-status-bar {
    display: flex;
    margin-top: 4px;
    padding-top: 4px;
  }
  .session-sidebar[data-view="micro"] .activity-glyph {
    font-size: 9px;
  }
  .session-sidebar[data-view="micro"] .activity-intensity-bar {
    display: none;
  }

  /* Micro mode: position popup on right side if sidebar is on right */
  .session-sidebar[data-view="micro"][data-position="right"] .session-details {
    left: auto;
    right: calc(100% + 4px);
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
        // AI Assistant detection fields (Claude, Cursor, etc.)
        aiAssistantId: null,         // 'claude' | 'cursor' | 'copilot-cli' | 'aider' | null
        claudeDetected: false,       // Legacy: true if Claude specifically
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
            // AI Assistant detection fields
            aiAssistantId: null,
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
      if (cwdBufferTimeouts[action.uid]) {
        clearTimeout(cwdBufferTimeouts[action.uid]);
        delete cwdBufferTimeouts[action.uid];
      }
      delete cwdBuffers[action.uid];
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

  // Clear all CWD buffer timeouts
  Object.keys(cwdBufferTimeouts).forEach((uid) => {
    clearTimeout(cwdBufferTimeouts[uid]);
    delete cwdBufferTimeouts[uid];
  });
  Object.keys(cwdBuffers).forEach((uid) => delete cwdBuffers[uid]);

  // Reset state
  Object.keys(sessions).forEach((uid) => delete sessions[uid]);
  activeUid = null;
  initialized = false;
};

// View mode cycle order
const VIEW_MODES = ['default', 'compact', 'micro'];
const VIEW_MODE_ICONS = {
  default: '\uf0c9',   // Hamburger/list icon
  compact: '\uf03a',   // List compact
  micro: '\uf009',     // Grid/dots
};

// Decorate Hyper to add sidebar
exports.decorateHyper = (Hyper, { React }) => {
  return class extends React.Component {
    constructor(props) {
      super(props);
      // Get initial view mode from config
      const sidebarConfig = (window.config && window.config.getConfig && window.config.getConfig().sessionSidebar) || {};
      const initialViewMode = sidebarConfig.viewMode || 'compact';
      this.state = {
        sessions: {},
        activeUid: null,
        viewMode: initialViewMode
      };
    }

    componentDidMount() {
      log('componentDidMount - sidebar initialized');

      // Set up visibility change listener for performance optimization
      this.handleVisibilityChange = () => {
        const isHidden = document.hidden;
        const newInterval = isHidden ? POLL_INTERVAL_HIDDEN : POLL_INTERVAL_ACTIVE;

        if (newInterval !== currentPollInterval) {
          log('Visibility changed:', { hidden: isHidden, interval: newInterval });
          currentPollInterval = newInterval;

          // Restart polling with new interval
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = setInterval(this.pollSessions.bind(this), currentPollInterval);
          }
        }
      };
      document.addEventListener('visibilitychange', this.handleVisibilityChange);

      // Set up IntersectionObserver for lazy git loading
      if (typeof IntersectionObserver !== 'undefined') {
        this.sessionObserver = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            const uid = entry.target.dataset.sessionUid;
            if (!uid) return;

            if (entry.isIntersecting) {
              visibleSessions.add(uid);
              // Trigger git info fetch for newly visible session
              const session = sessions[uid];
              if (session && session.cwd) {
                // Fetch if no branch yet OR if there was a pending fetch
                if (!session.git.branch || session._pendingGitFetch) {
                  session._pendingGitFetch = false;
                  getGitInfo(uid, session.cwd, true);  // Force visible
                }
              }
            } else {
              visibleSessions.delete(uid);
            }
          });
        }, { threshold: 0.1 });
      }

      // Poll for session updates
      pollInterval = setInterval(this.pollSessions.bind(this), currentPollInterval);
    }

    pollSessions() {
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
                // AI Assistant detection fields
                aiAssistantId: null,
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
    }

    componentWillUnmount() {
      log('componentWillUnmount');

      // Clean up visibility listener
      if (this.handleVisibilityChange) {
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      }

      // Clean up IntersectionObserver
      if (this.sessionObserver) {
        this.sessionObserver.disconnect();
        this.sessionObserver = null;
      }

      // Clear visible sessions tracking
      visibleSessions.clear();

      // Clear poll interval
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

    cycleViewMode() {
      const currentIndex = VIEW_MODES.indexOf(this.state.viewMode);
      const nextIndex = (currentIndex + 1) % VIEW_MODES.length;
      const nextMode = VIEW_MODES[nextIndex];
      log('cycleViewMode:', { from: this.state.viewMode, to: nextMode });
      this.setState({ viewMode: nextMode });
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
      // Add output type class for color-coded indicators
      if (data.lastOutputType && !data.claudeDetected) {
        className += ` output-${data.lastOutputType}`;
      }

      // Build session card with new structure
      return React.createElement(
        'div',
        {
          key: uid,
          className: className,
          'data-session-uid': uid,
          ref: (el) => {
            // Set up IntersectionObserver for lazy git loading
            if (el && this.sessionObserver) {
              this.sessionObserver.observe(el);
            }
          },
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
      const sidebarConfig = (window.config && window.config.getConfig && window.config.getConfig().sessionSidebar) || {};
      const position = sidebarConfig.position || 'left';

      const sidebar = React.createElement(
        'div',
        {
          className: 'session-sidebar',
          'data-view': this.state.viewMode,
          'data-position': position
        },
        // Header with count badge, view mode toggle, and optional refresh button
        React.createElement(
          'div',
          { className: 'session-sidebar-header' },
          React.createElement('span', null, 'Sessions'),
          React.createElement(
            'div',
            { className: 'session-header-actions' },
            // View mode toggle button
            React.createElement(
              'button',
              {
                className: 'session-viewmode-btn',
                onClick: () => this.cycleViewMode(),
                title: `View: ${this.state.viewMode} (click to cycle)`
              },
              VIEW_MODE_ICONS[this.state.viewMode]
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
