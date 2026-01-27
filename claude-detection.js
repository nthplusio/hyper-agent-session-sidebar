// Claude Code detection module for hyper-session-sidebar
// Detects Claude Code sessions and their current state

// Braille spinner characters used by Claude Code
const SPINNER_CHARS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_REGEX = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;

// Claude Code detection patterns
const CLAUDE_PATTERNS = {
  // Text patterns that indicate Claude Code
  textPatterns: [
    /claude[- ]?code/i,
    /anthropic/i,
    /\bclaude\b.*\btool/i,
    /\bclaude\b.*\bagent/i,
  ],

  // OSC 2 title pattern (terminal title set by Claude)
  titlePattern: /claude/i,

  // Tool names that appear in Claude Code output
  toolNames: [
    'Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep',
    'WebFetch', 'WebSearch', 'Task', 'TodoWrite'
  ],

  // Status text patterns
  statusPatterns: {
    working: [
      /running\s+\w+/i,
      /executing/i,
      /processing/i,
    ],
    thinking: [
      /thinking/i,
      /extended thinking/i,
      /reasoning/i,
    ],
    waiting: [
      /waiting for input/i,
      /press enter/i,
      /\?$/,  // Question prompts
    ],
  },
};

// Time thresholds (ms)
const THRESHOLDS = {
  // How long after spinner stops to transition from working to waiting
  spinnerIdleTimeout: 5000,
  // How long without any output to consider session idle
  idleTimeout: 30000,
  // Minimum time between state changes to prevent flicker
  stateDebounce: 500,
};

/**
 * Check if terminal output contains Claude Code indicators
 * @param {string} data - Terminal output data
 * @returns {boolean}
 */
const containsClaudeIndicators = (data) => {
  // Check for spinner characters
  if (SPINNER_REGEX.test(data)) {
    return true;
  }

  // Check for text patterns
  for (const pattern of CLAUDE_PATTERNS.textPatterns) {
    if (pattern.test(data)) {
      return true;
    }
  }

  // Check for tool names in output
  for (const tool of CLAUDE_PATTERNS.toolNames) {
    if (data.includes(tool)) {
      return true;
    }
  }

  return false;
};

/**
 * Check if a title indicates a Claude Code session
 * @param {string} title - Terminal title
 * @returns {boolean}
 */
const isCladeTitleIndicator = (title) => {
  return CLAUDE_PATTERNS.titlePattern.test(title || '');
};

/**
 * Detect if session is running Claude Code
 * @param {Object} session - Session data
 * @returns {boolean}
 */
const isClaudeCodeSession = (session) => {
  if (!session) return false;

  // Check if already detected
  if (session.claudeDetected) return true;

  // Check title
  if (isCladeTitleIndicator(session.title)) return true;

  // Check detected activity
  if (session.detectedActivity === 'claude-code') return true;

  return false;
};

/**
 * Detect spinner in output and return spinner phase
 * @param {string} data - Terminal output
 * @returns {number|null} - Spinner phase (0-9) or null if no spinner
 */
const detectSpinnerPhase = (data) => {
  for (let i = 0; i < SPINNER_CHARS.length; i++) {
    if (data.includes(SPINNER_CHARS[i])) {
      return i;
    }
  }
  return null;
};

/**
 * Determine Claude Code state from session data
 * @param {Object} session - Session data with claude fields
 * @param {string} data - Latest terminal output
 * @param {number} now - Current timestamp
 * @returns {Object} - { state, spinnerPhase, shouldUpdate }
 */
const detectClaudeState = (session, data, now) => {
  if (!session || !session.claudeDetected) {
    return { state: null, spinnerPhase: null, shouldUpdate: false };
  }

  const previousState = session.claudeState;
  const lastActivity = session.claudeLastActivity || 0;
  const timeSinceActivity = now - lastActivity;

  let newState = previousState || 'idle';
  let spinnerPhase = session.claudeSpinnerPhase;
  let shouldUpdate = false;

  // Check for spinner (indicates working)
  const detectedSpinner = detectSpinnerPhase(data);
  if (detectedSpinner !== null) {
    spinnerPhase = detectedSpinner;
    newState = 'working';
    shouldUpdate = true;
  }
  // Check for thinking patterns
  else if (CLAUDE_PATTERNS.statusPatterns.thinking.some(p => p.test(data))) {
    newState = 'thinking';
    shouldUpdate = true;
  }
  // Check for waiting patterns
  else if (CLAUDE_PATTERNS.statusPatterns.waiting.some(p => p.test(data))) {
    newState = 'waiting';
    shouldUpdate = true;
  }
  // If was working but no spinner for a while, transition to waiting
  else if (previousState === 'working' && timeSinceActivity > THRESHOLDS.spinnerIdleTimeout) {
    newState = 'waiting';
    shouldUpdate = true;
  }
  // If no activity for a long time, go idle
  else if (timeSinceActivity > THRESHOLDS.idleTimeout) {
    newState = 'idle';
    shouldUpdate = previousState !== 'idle';
  }

  // Debounce rapid state changes
  const lastStateChange = session.claudeLastStateChange || 0;
  if (shouldUpdate && (now - lastStateChange) < THRESHOLDS.stateDebounce) {
    shouldUpdate = false;
  }

  return { state: newState, spinnerPhase, shouldUpdate };
};

/**
 * Get display info for Claude state
 * @param {string} state - Claude state ('working', 'thinking', 'waiting', 'idle')
 * @returns {Object} - { label, icon, color, animation }
 */
const getClaudeStateInfo = (state) => {
  switch (state) {
    case 'working':
      return {
        label: 'Working',
        icon: '✦',  // Sparkle for Claude
        color: '#a6e3a1',  // Green
        animation: 'glyph-pulse',
      };
    case 'thinking':
      return {
        label: 'Thinking',
        icon: '✦',
        color: '#cba6f7',  // Purple/Magenta
        animation: 'glyph-pulse-slow',
      };
    case 'waiting':
      return {
        label: 'Waiting',
        icon: '✦',
        color: '#f9e2af',  // Yellow/Amber
        animation: null,
      };
    case 'idle':
    default:
      return {
        label: 'Idle',
        icon: '✦',
        color: '#6c7086',  // Gray
        animation: null,
      };
  }
};

/**
 * Update session with Claude detection results
 * @param {Object} session - Session object to update
 * @param {string} data - Terminal output data
 * @param {number} now - Current timestamp
 * @returns {boolean} - Whether session was updated
 */
const updateClaudeDetection = (session, data, now) => {
  if (!session) return false;

  let updated = false;

  // Initial detection
  if (!session.claudeDetected && containsClaudeIndicators(data)) {
    session.claudeDetected = true;
    session.claudeState = 'idle';
    session.claudeSpinnerPhase = null;
    session.claudeLastActivity = now;
    session.claudeLastStateChange = now;
    updated = true;
  }

  // State updates for detected Claude sessions
  if (session.claudeDetected) {
    const { state, spinnerPhase, shouldUpdate } = detectClaudeState(session, data, now);

    if (shouldUpdate) {
      session.claudeState = state;
      session.claudeSpinnerPhase = spinnerPhase;
      session.claudeLastStateChange = now;
      updated = true;
    }

    // Always update last activity time on any output
    if (data.length > 0) {
      session.claudeLastActivity = now;
    }
  }

  return updated;
};

module.exports = {
  SPINNER_CHARS,
  SPINNER_REGEX,
  CLAUDE_PATTERNS,
  THRESHOLDS,
  containsClaudeIndicators,
  isClaudeCodeSession,
  detectSpinnerPhase,
  detectClaudeState,
  getClaudeStateInfo,
  updateClaudeDetection,
};
