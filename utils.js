// Hot-reloadable utility functions for hyper-session-sidebar
const path = require('path');

// Import AI assistant detection module
let aiDetection;
try {
  aiDetection = require('./claude-detection');
} catch (e) {
  // Fallback if module not found
  aiDetection = {
    isClaudeCodeSession: () => false,
    isAIAssistantSession: () => false,
    getClaudeStateInfo: () => ({ label: 'Idle', icon: '✦', color: '#6c7086', animation: null }),
    getAssistantStateInfo: () => ({ label: 'Idle', icon: '✦', color: '#6c7086', animation: null }),
  };
}

// Legacy alias
const claudeDetection = aiDetection;

// Import icon library
let icons;
try {
  icons = require('./icons');
} catch (e) {
  icons = { getIconSvg: () => '', hasIcon: () => false };
}

// Unified shell icon mapping - Lucide icons for all components
// Each entry: { icon: 'lucide-icon-name', color: '#hex' }
const shellIcons = {
  powershell: { icon: 'terminal', color: '#5391FE' },
  pwsh: { icon: 'terminal', color: '#5391FE' },
  bash: { icon: 'terminal', color: '#89e051' },
  zsh: { icon: 'terminal', color: '#89e051' },
  fish: { icon: 'terminal', color: '#fab387' },
  cmd: { icon: 'square-terminal', color: '#cdd6f4' },
  node: { icon: 'hexagon', color: '#8CC84B' },
  python: { icon: 'code', color: '#FFD43B' },
  ruby: { icon: 'gem', color: '#CC342D' },
  default: { icon: 'terminal', color: '#89b4fa' },
};

// Claude orange color (matches the Claude crab)
const CLAUDE_ORANGE = '#f5a623';

// Helper to create icon info with SVG
const makeIconInfo = (iconDef, size = 14) => {
  const svg = icons.getIconSvg ? icons.getIconSvg(iconDef.icon, size) : '';
  return {
    icon: iconDef.icon,
    color: iconDef.color,
    svg: svg,
    isSvg: svg.length > 0,
  };
};

// Get shell icon and color based on shell path, title, or AI assistant detection
const getShellInfo = (session, size = 14) => {
  // Check if this is an AI assistant session - show bot icon with orange color
  const isAI = session.claudeDetected || session.aiAssistantId ||
    (aiDetection.isAIAssistantSession && aiDetection.isAIAssistantSession(session));

  if (isAI) {
    return makeIconInfo({ icon: 'bot', color: CLAUDE_ORANGE }, size);
  }

  const shell = (session.shell || '').toLowerCase();
  const title = (session.title || '').toLowerCase();

  // Check shell path
  if (shell.includes('powershell') || shell.includes('pwsh')) {
    return makeIconInfo(shellIcons.powershell, size);
  }
  if (shell.includes('bash')) {
    return makeIconInfo(shellIcons.bash, size);
  }
  if (shell.includes('zsh')) {
    return makeIconInfo(shellIcons.zsh, size);
  }
  if (shell.includes('fish')) {
    return makeIconInfo(shellIcons.fish, size);
  }
  if (shell.includes('cmd')) {
    return makeIconInfo(shellIcons.cmd, size);
  }
  if (shell.includes('node')) {
    return makeIconInfo(shellIcons.node, size);
  }
  if (shell.includes('python')) {
    return makeIconInfo(shellIcons.python, size);
  }

  // Check title for running process
  if (title.includes('node')) {
    return makeIconInfo(shellIcons.node, size);
  }
  if (title.includes('python') || title.includes('pip')) {
    return makeIconInfo(shellIcons.python, size);
  }
  if (title.includes('ruby') || title.includes('gem')) {
    return makeIconInfo(shellIcons.ruby, size);
  }

  return makeIconInfo(shellIcons.default, size);
};

// Extract process name from shell path or title
const getProcessName = (session) => {
  if (session.title && session.title.length > 0) {
    const title = session.title;
    if (title.includes(' - ')) {
      return title.split(' - ')[0].trim();
    }
    return title;
  }
  if (session.shell) {
    return path.basename(session.shell, '.exe');
  }
  return 'shell';
};

// Shorten path for display - show only leaf directory with ../ prefix if not root
const shortenPath = (fullPath) => {
  if (!fullPath) return '';

  // Normalize path separators
  const normalized = fullPath.replace(/\\/g, '/');

  // Check if it's a root path (e.g., "C:/" or "/")
  const isWindowsRoot = /^[A-Za-z]:\/?$/.test(fullPath.replace(/\\/g, '/'));
  const isUnixRoot = fullPath === '/';

  if (isWindowsRoot || isUnixRoot) {
    return fullPath;
  }

  // Get the leaf directory name
  const parts = normalized.split('/').filter(p => p && !p.match(/^[A-Za-z]:$/));
  const leaf = parts[parts.length - 1] || fullPath;

  // Add ../ prefix if there's a parent directory
  if (parts.length > 1) {
    return '../' + leaf;
  }

  return leaf;
};

// Get shell icon for launcher buttons (uses Lucide SVG icons)
const getShellIconForLauncher = (shell, size = 22) => {
  const shellPath = (shell.shell || '').toLowerCase();
  const shellName = (shell.name || '').toLowerCase();

  let iconDef;
  if (shellPath.includes('powershell') || shellPath.includes('pwsh')) {
    iconDef = shellIcons.powershell;
  } else if (shellPath.includes('git') || shellName.includes('git') || shellPath.includes('bash')) {
    iconDef = shellIcons.bash;
  } else if (shellPath.includes('cmd')) {
    iconDef = shellIcons.cmd;
  } else {
    iconDef = shellIcons.default;
  }

  return makeIconInfo(iconDef, size);
};

// Extract a path from terminal title (Windows titles often contain the CWD)
const extractPathFromTitle = (title) => {
  if (!title) return '';

  // Git Bash MINGW64: "MINGW64:/c/Users/name" -> "C:/Users/name"
  // This is reliable - Git Bash title shows actual CWD
  const mingwMatch = title.match(/MINGW\d*:?\s*(\/[a-z](\/[^\s]*)?)/i);
  if (mingwMatch) {
    const unixPath = mingwMatch[1];
    const drive = unixPath.charAt(1).toUpperCase();
    const rest = unixPath.slice(2) || '/';
    return drive + ':' + rest;
  }

  // For Windows paths in title, be very selective
  // Only use if it looks like a user directory, not a system/program path
  const windowsPathMatch = title.match(/([A-Za-z]:\\[^\r\n]*)/);
  if (windowsPathMatch) {
    let extractedPath = windowsPathMatch[1];

    // Skip if it's an executable path (not a CWD)
    if (/\.(exe|cmd|bat|com|ps1)$/i.test(extractedPath)) {
      return '';
    }

    // Skip system/program directories - these are likely shell install paths, not CWD
    const systemPaths = [
      /\\windows\\/i,
      /\\program files/i,
      /\\windowspowershell\\/i,
      /\\system32\\/i,
      /\\git\\bin/i,
      /\\appdata\\local\\programs\\/i,
    ];

    for (const pattern of systemPaths) {
      if (pattern.test(extractedPath)) {
        return '';
      }
    }

    return extractedPath;
  }

  // Generic Unix path (but not root alone)
  const unixPathMatch = title.match(/(\/[^\s]+)/);
  if (unixPathMatch && unixPathMatch[1] !== '/') {
    return unixPathMatch[1];
  }

  return '';
};

/**
 * Get activity glyph info for a session
 * Returns info for rendering the activity indicator dot/icon
 * @param {Object} session - Session data
 * @returns {Object} - { icon, className, title, style }
 */
const getActivityGlyph = (session) => {
  if (!session) {
    return {
      icon: null,
      className: 'activity-glyph inactive',
      title: 'Inactive',
      style: {},
    };
  }

  // Check if this is an AI assistant session (Claude, Cursor, etc.)
  const isAI = session.claudeDetected || session.aiAssistantId ||
    (aiDetection.isAIAssistantSession && aiDetection.isAIAssistantSession(session));

  if (isAI) {
    const assistantId = session.aiAssistantId || 'claude';
    const stateInfo = aiDetection.getAssistantStateInfo
      ? aiDetection.getAssistantStateInfo(session.claudeState, assistantId)
      : aiDetection.getClaudeStateInfo(session.claudeState);

    // Get assistant name for display
    const assistantName = aiDetection.ASSISTANT_MAP && aiDetection.ASSISTANT_MAP[assistantId]
      ? aiDetection.ASSISTANT_MAP[assistantId].name
      : 'Claude';

    // Use star icon (not robot - robot is for shell icon)
    return {
      icon: '✦',
      className: `activity-glyph star claude ${session.claudeState || 'idle'}`,
      title: `${assistantName}: ${stateInfo.label}`,
      style: { color: stateInfo.color },
    };
  }

  // Standard terminal session activity states
  const activityType = session.activityType || 'idle';
  const outputType = session.lastOutputType;

  // Build base class name
  let className = 'activity-glyph';
  let title = 'Inactive';

  switch (activityType) {
    case 'output':
    case 'command':
      className += ' running';
      title = 'Running';
      break;
    case 'typing':
      className += ' has-output';
      title = 'Has output';
      break;
    case 'idle':
    default:
      className += ' inactive';
      title = 'Inactive';
      break;
  }

  // Add output type class for color coding
  if (outputType) {
    className += ` output-${outputType}`;
    const outputTypeLabels = {
      error: 'Error',
      warning: 'Warning',
      success: 'Success',
      progress: 'In Progress'
    };
    title = outputTypeLabels[outputType] || title;
  }

  // Use star icon instead of CSS dot
  className += ' star';

  return {
    icon: '✦',
    className,
    title,
    style: {},
  };
};

/**
 * Get activity type info for display
 * @param {string} activityType - Activity type ('idle', 'output', 'typing', 'command')
 * @returns {Object} - { label, color }
 */
const getActivityTypeInfo = (activityType) => {
  switch (activityType) {
    case 'command':
      return { label: 'Running', color: '#a6e3a1' };  // Green
    case 'output':
      return { label: 'Output', color: '#94e2d5' };   // Cyan
    case 'typing':
      return { label: 'Typing', color: '#89b4fa' };   // Blue
    case 'idle':
    default:
      return { label: 'Idle', color: '#6c7086' };     // Gray
  }
};

module.exports = {
  shellIcons,
  icons,
  makeIconInfo,
  getShellInfo,
  getProcessName,
  shortenPath,
  getShellIconForLauncher,
  extractPathFromTitle,
  getActivityGlyph,
  getActivityTypeInfo,
};
