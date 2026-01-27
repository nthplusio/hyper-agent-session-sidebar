# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hyper terminal plugin that adds a session management sidebar with shell quick-launch buttons, git status, CWD tracking, and activity indicators.

## Architecture

**Entry Point**: `index.js` - Main plugin file that exports Hyper hooks

**Key Exports** (Hyper Plugin API):
- `decorateConfig` - Injects CSS, reads user config, derives theme colors from Hyper theme
- `decorateHyper` - Adds the sidebar React component to Hyper's UI
- `middleware` - Redux middleware tracking session lifecycle (SESSION_ADD, SESSION_SET_ACTIVE, SESSION_PTY_EXIT)
- `decorateKeymaps` / `mapTermsDispatch` - Keyboard shortcut handling for shell launching
- `onWindow` - RPC handler for "sidebar open shell tab" events

**Utils Module**: `utils.js` - Hot-reloadable utility functions (shell icons, path formatting, title parsing, activity glyphs). When `DEV_LOGGING=true`, utils are re-required on each call for live development.

**Claude Detection Module**: `claude-detection.js` - Detects Claude Code sessions and their working state (working/thinking/waiting/idle) based on spinner characters and output patterns.

**State Management**:
- `sessions` object - Plugin's internal session tracking (uid, pid, shell, cwd, git info, activity)
- Synced with Hyper's Redux store via polling in `componentDidMount` (500ms interval)
- Git info is debounced per-session (500ms)
- Activity tracking fields: `activityType`, `activityIntensity`, `lastOutputTime`, `outputBurstCount`
- Claude detection fields: `claudeDetected`, `claudeState`, `claudeSpinnerPhase`, `claudeLastActivity`

**CWD Detection** (`cwdPatterns` array):
- Pattern-based extraction from terminal output (OSC 7, OSC 9;9, PowerShell prompts, Git Bash MINGW, etc.)
- Each pattern has: `regex`, optional `transform`, optional `skipIf`
- First matching pattern wins

**Theme Integration**:
- Colors derived from Hyper's `config.backgroundColor`, `config.foregroundColor`, `config.colors`
- Uses `darkenColor`/`lightenColor` helpers to generate surface variants
- User can override via `sessionSidebar.theme` config object

## Development

### Debug Logging

Set `DEV_LOGGING = true` in index.js to enable:
- File logging to `debug.log` in plugin directory
- Hot-reload support for `utils.js`
- Refresh button in sidebar header

Monitor logs:
```powershell
Get-Content "debug.log" -Wait -Tail 20
```

### Testing Changes

1. Edit files
2. If `DEV_LOGGING=true`: Click refresh button or reload Hyper window
3. If `DEV_LOGGING=false`: Restart Hyper completely

### Adding CWD Detection Patterns

Add to `cwdPatterns` array in index.js:
```javascript
{
  name: 'Pattern Name',
  description: 'Documentation',
  regex: /pattern/,  // capture group 1 = path
  transform: (match) => {},  // optional
  skipIf: (path) => {},      // optional, return true to skip
}
```

## Activity Detection

### Standard Terminal Activity
- **Running (green)**: Rapid output detected (< 100ms between chunks), likely command executing
- **Has output (cyan)**: Normal output activity in background sessions
- **Inactive (gray)**: No recent activity

Activity intensity is tracked (0-100) based on output frequency and displayed as an intensity bar at the bottom of session cards.

### Claude Code Detection
When `enableClaudeDetection` is enabled (default), the plugin detects Claude Code sessions by:
- Braille spinner characters (⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏)
- Text patterns ("claude code", "anthropic", tool names)

Claude session states:
- **Working (green, pulsing ✦)**: Spinner detected, actively processing/using tools
- **Thinking (purple, slow pulse ✦)**: Extended thinking mode detected
- **Waiting (yellow, solid ✦)**: No spinner for 5+ seconds, waiting for input
- **Idle (gray ✦)**: No activity signals

## Configuration Reference

User config is read from `.hyper.js`:
- `config.shells[]` - Shell definitions for quick-launch (name, shell path, args, shortcut, default)
- `config.selectShellKeymap` - Modifier prefix for shell shortcuts (e.g., 'ctrl+shift')
- `config.sessionSidebar` - Sidebar options:
  - `width`, `position`, `showGit`, `showCwd`, `showPid`, `showShellLauncher`
  - `activityTimeout` - ms to show activity indicator (default: 3000)
  - `enableClaudeDetection` - Auto-detect Claude Code sessions (default: true)
  - `claudeIdleTimeout` - ms before working → waiting transition (default: 5000)
  - `showActivityGlyph` - Show activity glyph (dot/icon) (default: true)
  - `theme` - Override theme colors
