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

// Shell icon mapping - SVG icons for reliable rendering
// SVG paths are from Lucide/Feather or custom designed
const shellIcons = {
  powershell: {
    icon: 'svg:terminal',
    color: '#5391FE'
  },
  pwsh: {
    icon: 'svg:terminal',
    color: '#5391FE'
  },
  bash: {
    icon: 'svg:terminal',
    color: '#89e051'
  },
  zsh: {
    icon: 'svg:terminal',
    color: '#89e051'
  },
  fish: {
    icon: 'svg:terminal',
    color: '#fab387'
  },
  cmd: {
    icon: 'svg:terminal-square',
    color: '#cdd6f4'
  },
  node: {
    icon: 'svg:hexagon',
    color: '#8CC84B'
  },
  python: {
    icon: 'svg:code',
    color: '#FFD43B'
  },
  ruby: {
    icon: 'svg:gem',
    color: '#CC342D'
  },
  default: {
    icon: 'svg:terminal',
    color: '#89b4fa'
  },
};

// SVG icon definitions (Lucide-style, 24x24 viewBox)
const svgIcons = {
  'terminal': '<path d="M4 17l6-6-6-6M12 19h8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  'terminal-square': '<rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M7 15l4-4-4-4M13 15h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  'hexagon': '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" stroke="currentColor" stroke-width="2" fill="none"/>',
  'code': '<polyline points="16 18 22 12 16 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><polyline points="8 6 2 12 8 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  'gem': '<path d="M6 3h12l4 6-10 13L2 9z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M12 22V9M2 9h20M6 3l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  'robot': '<rect x="3" y="11" width="18" height="10" rx="2" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="5" r="2" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 7v4M8 16h0M16 16h0" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>',
};

// Helper to check if icon is SVG type
const isSvgIcon = (icon) => icon && icon.startsWith('svg:');

// Get SVG markup for an icon
const getSvgMarkup = (iconKey, size = 16) => {
  const key = iconKey.replace('svg:', '');
  const path = svgIcons[key];
  if (!path) return null;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${path}</svg>`;
};

// Claude orange color (matches the Claude crab)
const CLAUDE_ORANGE = '#f5a623';

// Get shell icon and color based on shell path, title, or AI assistant detection
const getShellInfo = (session) => {
  // Check if this is an AI assistant session - show robot icon with orange color
  const isAI = session.claudeDetected || session.aiAssistantId ||
    (aiDetection.isAIAssistantSession && aiDetection.isAIAssistantSession(session));

  if (isAI) {
    return { icon: '\ueb99', color: CLAUDE_ORANGE };  // Robot icon, Claude orange
  }

  const shell = (session.shell || '').toLowerCase();
  const title = (session.title || '').toLowerCase();

  // Check shell path
  if (shell.includes('powershell') || shell.includes('pwsh')) {
    return shellIcons.powershell;
  }
  if (shell.includes('bash')) {
    return shellIcons.bash;
  }
  if (shell.includes('zsh')) {
    return shellIcons.zsh;
  }
  if (shell.includes('fish')) {
    return shellIcons.fish;
  }
  if (shell.includes('cmd')) {
    return shellIcons.cmd;
  }
  if (shell.includes('node')) {
    return shellIcons.node;
  }
  if (shell.includes('python')) {
    return shellIcons.python;
  }

  // Check title for running process
  if (title.includes('node')) {
    return shellIcons.node;
  }
  if (title.includes('python') || title.includes('pip')) {
    return shellIcons.python;
  }
  if (title.includes('ruby') || title.includes('gem')) {
    return shellIcons.ruby;
  }

  return shellIcons.default;
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

// Get shell icon for launcher buttons
const getShellIconForLauncher = (shell) => {
  const shellPath = (shell.shell || '').toLowerCase();
  const shellName = (shell.name || '').toLowerCase();

  if (shellPath.includes('powershell') || shellPath.includes('pwsh')) {
    return shellIcons.powershell;
  }
  // Git Bash - use bash icon with git-bash green
  if (shellPath.includes('git') || shellName.includes('git') || shellPath.includes('bash')) {
    return shellIcons.bash;
  }
  if (shellPath.includes('cmd')) {
    return shellIcons.cmd;
  }
  if (shellPath.includes('zsh')) {
    return shellIcons.zsh;
  }
  if (shellPath.includes('fish')) {
    return shellIcons.fish;
  }
  return shellIcons.default;
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
  svgIcons,
  isSvgIcon,
  getSvgMarkup,
  getShellInfo,
  getProcessName,
  shortenPath,
  getShellIconForLauncher,
  extractPathFromTitle,
  getActivityGlyph,
  getActivityTypeInfo,
};
