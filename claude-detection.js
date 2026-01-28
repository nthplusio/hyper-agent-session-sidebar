// AI Assistant detection module for hyper-session-sidebar
// Extensible system for detecting Claude Code, Cursor, Copilot CLI, Aider, etc.

// =============================================================================
// BASE AI ASSISTANT DETECTION FRAMEWORK
// =============================================================================

/**
 * AI Assistant definition interface:
 * {
 *   id: string,           // Unique identifier
 *   name: string,         // Display name
 *   icon: string,         // Display icon
 *   spinnerChars: string[], // Spinner characters used by this assistant
 *   textPatterns: RegExp[],  // Text patterns that indicate this assistant
 *   titlePatterns: RegExp[], // Terminal title patterns
 *   uiPatterns: RegExp[],    // UI element patterns (box drawing, etc.)
 *   toolPatterns: RegExp[],  // Tool usage patterns
 *   states: Object,          // State definitions with patterns
 *   thresholds: Object,      // Timing thresholds
 * }
 */

// =============================================================================
// CLAUDE CODE DEFINITION
// =============================================================================

const CLAUDE_ASSISTANT = {
  id: 'claude',
  name: 'Claude Code',
  icon: '✦',

  // Braille spinner characters used by Claude Code
  spinnerChars: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],

  // Text patterns that indicate Claude Code is running
  textPatterns: [
    /claude[- ]?code/i,
    /anthropic/i,
    /\bclaude\b.*\btool/i,
    /\bclaude\b.*\bagent/i,
    /powered by claude/i,
  ],

  // Terminal title patterns
  titlePatterns: [
    /claude/i,
    /anthropic/i,
  ],

  // UI patterns - Claude uses box-drawing characters for its interface
  uiPatterns: [
    /[┌┐└┘│─├┤┬┴┼]/,  // Box drawing
    /╭.*╮|╰.*╯/,       // Rounded corners
    /⎯{3,}/,           // Horizontal rules
  ],

  // Tool usage patterns (more specific than just tool names)
  toolPatterns: [
    /[│┃]\s*(Read|Edit|Write|Bash|Glob|Grep|Task)\s/,  // Tool in box UI
    /⠋.*(?:Read|Edit|Write|Bash)/,   // Spinner + tool
    /Tool:\s*(Read|Edit|Write|Bash|Glob|Grep)/i,
    /Using\s+(Read|Edit|Write|Bash)/i,
  ],

  // State definitions
  states: {
    working: {
      label: 'Working',
      color: '#a6e3a1',  // Green
      animation: 'glyph-pulse',
      patterns: [
        /running\s+\w+/i,
        /executing/i,
        /processing/i,
      ],
    },
    thinking: {
      label: 'Thinking',
      color: '#cba6f7',  // Purple
      animation: 'glyph-pulse-slow',
      patterns: [
        /thinking/i,
        /extended thinking/i,
        /reasoning/i,
      ],
    },
    waiting: {
      label: 'Waiting',
      color: '#f9e2af',  // Yellow
      animation: null,
      patterns: [
        /waiting for input/i,
        /press enter/i,
        /\?$/,  // Question prompts
        />\s*$/,  // Input prompt
      ],
    },
    idle: {
      label: 'Idle',
      color: '#6c7086',  // Gray
      animation: null,
      patterns: [],
    },
  },

  // Timing thresholds
  thresholds: {
    spinnerIdleTimeout: 5000,   // ms after spinner stops to become waiting
    idleTimeout: 30000,         // ms without activity to become idle
    stateDebounce: 500,         // ms between state changes
  },
};

// =============================================================================
// FUTURE AI ASSISTANTS (templates for extension)
// =============================================================================

const CURSOR_ASSISTANT = {
  id: 'cursor',
  name: 'Cursor',
  icon: '⌘',
  spinnerChars: [],  // TBD
  textPatterns: [
    /cursor\s+ai/i,
    /cursor\s+composer/i,
  ],
  titlePatterns: [/cursor/i],
  uiPatterns: [],
  toolPatterns: [],
  states: {
    working: { label: 'Working', color: '#a6e3a1', animation: 'glyph-pulse', patterns: [] },
    waiting: { label: 'Waiting', color: '#f9e2af', animation: null, patterns: [] },
    idle: { label: 'Idle', color: '#6c7086', animation: null, patterns: [] },
  },
  thresholds: {
    spinnerIdleTimeout: 5000,
    idleTimeout: 30000,
    stateDebounce: 500,
  },
};

const COPILOT_CLI_ASSISTANT = {
  id: 'copilot-cli',
  name: 'GitHub Copilot CLI',
  icon: '',
  spinnerChars: [],
  textPatterns: [
    /github\s+copilot/i,
    /gh\s+copilot/i,
  ],
  titlePatterns: [/copilot/i],
  uiPatterns: [],
  toolPatterns: [],
  states: {
    working: { label: 'Working', color: '#a6e3a1', animation: 'glyph-pulse', patterns: [] },
    waiting: { label: 'Waiting', color: '#f9e2af', animation: null, patterns: [] },
    idle: { label: 'Idle', color: '#6c7086', animation: null, patterns: [] },
  },
  thresholds: {
    spinnerIdleTimeout: 5000,
    idleTimeout: 30000,
    stateDebounce: 500,
  },
};

const AIDER_ASSISTANT = {
  id: 'aider',
  name: 'Aider',
  icon: '🤖',
  spinnerChars: [],
  textPatterns: [
    /aider\s+v?\d/i,
    /aider\.chat/i,
  ],
  titlePatterns: [/aider/i],
  uiPatterns: [],
  toolPatterns: [],
  states: {
    working: { label: 'Working', color: '#a6e3a1', animation: 'glyph-pulse', patterns: [] },
    waiting: { label: 'Waiting', color: '#f9e2af', animation: null, patterns: [] },
    idle: { label: 'Idle', color: '#6c7086', animation: null, patterns: [] },
  },
  thresholds: {
    spinnerIdleTimeout: 5000,
    idleTimeout: 30000,
    stateDebounce: 500,
  },
};

// =============================================================================
// REGISTERED ASSISTANTS
// =============================================================================

const AI_ASSISTANTS = [
  CLAUDE_ASSISTANT,
  // Future: CURSOR_ASSISTANT, COPILOT_CLI_ASSISTANT, AIDER_ASSISTANT
];

// Build lookup map
const ASSISTANT_MAP = {};
AI_ASSISTANTS.forEach(a => { ASSISTANT_MAP[a.id] = a; });

// Build combined spinner regex for quick detection
const ALL_SPINNER_CHARS = AI_ASSISTANTS.flatMap(a => a.spinnerChars);
const SPINNER_REGEX = ALL_SPINNER_CHARS.length > 0
  ? new RegExp(`[${ALL_SPINNER_CHARS.join('')}]`)
  : /(?!)/;  // Never matches

// =============================================================================
// DETECTION FUNCTIONS
// =============================================================================

/**
 * Check if terminal output contains indicators for any AI assistant
 * @param {string} data - Terminal output data
 * @returns {{ detected: boolean, assistantId: string|null }}
 */
const detectAIAssistant = (data) => {
  for (const assistant of AI_ASSISTANTS) {
    // Check spinner
    for (const char of assistant.spinnerChars) {
      if (data.includes(char)) {
        return { detected: true, assistantId: assistant.id };
      }
    }

    // Check text patterns
    for (const pattern of assistant.textPatterns) {
      if (pattern.test(data)) {
        return { detected: true, assistantId: assistant.id };
      }
    }

    // Check UI patterns
    for (const pattern of assistant.uiPatterns) {
      if (pattern.test(data)) {
        return { detected: true, assistantId: assistant.id };
      }
    }

    // Check tool patterns (more specific)
    for (const pattern of assistant.toolPatterns) {
      if (pattern.test(data)) {
        return { detected: true, assistantId: assistant.id };
      }
    }
  }

  return { detected: false, assistantId: null };
};

/**
 * Check if a title indicates any AI assistant
 * @param {string} title - Terminal title
 * @returns {{ detected: boolean, assistantId: string|null }}
 */
const detectAIAssistantFromTitle = (title) => {
  if (!title) return { detected: false, assistantId: null };

  for (const assistant of AI_ASSISTANTS) {
    for (const pattern of assistant.titlePatterns) {
      if (pattern.test(title)) {
        return { detected: true, assistantId: assistant.id };
      }
    }
  }

  return { detected: false, assistantId: null };
};

/**
 * Detect if session is running any AI assistant
 * @param {Object} session - Session data
 * @returns {boolean}
 */
const isAIAssistantSession = (session) => {
  if (!session) return false;
  return session.claudeDetected || session.aiAssistantId != null;
};

/**
 * Legacy: Check if session is running Claude Code specifically
 * @param {Object} session - Session data
 * @returns {boolean}
 */
const isClaudeCodeSession = (session) => {
  if (!session) return false;
  if (session.claudeDetected) return true;
  if (session.aiAssistantId === 'claude') return true;

  // Check title
  const titleResult = detectAIAssistantFromTitle(session.title);
  if (titleResult.assistantId === 'claude') return true;

  // Check detected activity
  if (session.detectedActivity === 'claude-code') return true;

  return false;
};

/**
 * Detect spinner in output and return spinner phase
 * @param {string} data - Terminal output
 * @param {string} assistantId - AI assistant ID
 * @returns {number|null} - Spinner phase or null if no spinner
 */
const detectSpinnerPhase = (data, assistantId = 'claude') => {
  const assistant = ASSISTANT_MAP[assistantId];
  if (!assistant) return null;

  for (let i = 0; i < assistant.spinnerChars.length; i++) {
    if (data.includes(assistant.spinnerChars[i])) {
      return i;
    }
  }
  return null;
};

/**
 * Determine AI assistant state from session data
 * @param {Object} session - Session data
 * @param {string} data - Latest terminal output
 * @param {number} now - Current timestamp
 * @returns {Object} - { state, spinnerPhase, shouldUpdate }
 */
const detectAssistantState = (session, data, now) => {
  const assistantId = session.aiAssistantId || 'claude';
  const assistant = ASSISTANT_MAP[assistantId];

  if (!assistant || (!session.claudeDetected && !session.aiAssistantId)) {
    return { state: null, spinnerPhase: null, shouldUpdate: false };
  }

  const previousState = session.claudeState;
  const lastActivity = session.claudeLastActivity || 0;
  const timeSinceActivity = now - lastActivity;
  const thresholds = assistant.thresholds;

  let newState = previousState || 'idle';
  let spinnerPhase = session.claudeSpinnerPhase;
  let shouldUpdate = false;

  // Check for spinner (indicates working)
  const detectedSpinner = detectSpinnerPhase(data, assistantId);
  if (detectedSpinner !== null) {
    spinnerPhase = detectedSpinner;
    newState = 'working';
    shouldUpdate = true;
  }
  // Check for state-specific patterns
  else {
    for (const [stateName, stateConfig] of Object.entries(assistant.states)) {
      if (stateName === 'idle') continue;  // Skip idle, it's the default

      for (const pattern of stateConfig.patterns || []) {
        if (pattern.test(data)) {
          newState = stateName;
          shouldUpdate = true;
          break;
        }
      }
      if (shouldUpdate) break;
    }
  }

  // State transitions based on timing
  if (!shouldUpdate) {
    // If was working but no spinner for a while, transition to waiting
    if (previousState === 'working' && timeSinceActivity > thresholds.spinnerIdleTimeout) {
      newState = 'waiting';
      shouldUpdate = true;
    }
    // If no activity for a long time, go idle
    else if (timeSinceActivity > thresholds.idleTimeout) {
      newState = 'idle';
      shouldUpdate = previousState !== 'idle';
    }
  }

  // Debounce rapid state changes
  const lastStateChange = session.claudeLastStateChange || 0;
  if (shouldUpdate && (now - lastStateChange) < thresholds.stateDebounce) {
    shouldUpdate = false;
  }

  return { state: newState, spinnerPhase, shouldUpdate };
};

/**
 * Get display info for AI assistant state
 * @param {string} state - Assistant state
 * @param {string} assistantId - AI assistant ID
 * @returns {Object} - { label, icon, color, animation }
 */
const getAssistantStateInfo = (state, assistantId = 'claude') => {
  const assistant = ASSISTANT_MAP[assistantId] || CLAUDE_ASSISTANT;
  const stateConfig = assistant.states[state] || assistant.states.idle;

  return {
    label: stateConfig.label,
    icon: assistant.icon,
    color: stateConfig.color,
    animation: stateConfig.animation,
  };
};

/**
 * Legacy: Get display info for Claude state
 * @param {string} state - Claude state
 * @returns {Object} - { label, icon, color, animation }
 */
const getClaudeStateInfo = (state) => {
  return getAssistantStateInfo(state, 'claude');
};

/**
 * Update session with AI assistant detection results
 * @param {Object} session - Session object to update
 * @param {string} data - Terminal output data
 * @param {number} now - Current timestamp
 * @returns {boolean} - Whether session was updated
 */
const updateAIAssistantDetection = (session, data, now) => {
  if (!session) return false;

  let updated = false;

  // Initial detection
  if (!session.claudeDetected && !session.aiAssistantId) {
    const result = detectAIAssistant(data);
    if (result.detected) {
      session.aiAssistantId = result.assistantId;
      session.claudeDetected = result.assistantId === 'claude';  // Legacy compat
      session.claudeState = 'idle';
      session.claudeSpinnerPhase = null;
      session.claudeLastActivity = now;
      session.claudeLastStateChange = now;
      updated = true;
    }
  }

  // State updates for detected sessions
  if (session.claudeDetected || session.aiAssistantId) {
    const { state, spinnerPhase, shouldUpdate } = detectAssistantState(session, data, now);

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

/**
 * Legacy: Update session with Claude detection results
 */
const updateClaudeDetection = updateAIAssistantDetection;

// =============================================================================
// EXPORTS
// =============================================================================

// Legacy exports (for backward compatibility)
const SPINNER_CHARS = CLAUDE_ASSISTANT.spinnerChars;
const CLAUDE_PATTERNS = {
  textPatterns: CLAUDE_ASSISTANT.textPatterns,
  titlePattern: CLAUDE_ASSISTANT.titlePatterns[0],
  toolNames: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite'],
  statusPatterns: {
    working: CLAUDE_ASSISTANT.states.working.patterns,
    thinking: CLAUDE_ASSISTANT.states.thinking.patterns,
    waiting: CLAUDE_ASSISTANT.states.waiting.patterns,
  },
};
const THRESHOLDS = CLAUDE_ASSISTANT.thresholds;

module.exports = {
  // Legacy exports
  SPINNER_CHARS,
  SPINNER_REGEX,
  CLAUDE_PATTERNS,
  THRESHOLDS,
  isClaudeCodeSession,
  detectSpinnerPhase,
  getClaudeStateInfo,
  updateClaudeDetection,

  // New extensible exports
  AI_ASSISTANTS,
  ASSISTANT_MAP,
  detectAIAssistant,
  detectAIAssistantFromTitle,
  isAIAssistantSession,
  detectAssistantState,
  getAssistantStateInfo,
  updateAIAssistantDetection,

  // Individual assistant definitions (for customization)
  CLAUDE_ASSISTANT,
  CURSOR_ASSISTANT,
  COPILOT_CLI_ASSISTANT,
  AIDER_ASSISTANT,
};
