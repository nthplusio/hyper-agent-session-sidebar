# hyper-agent-session-sidebar

A Hyper terminal plugin that adds a sidebar for managing terminal sessions with shell quick-launch buttons, git status, CWD tracking, and activity indicators.

## Features

- **Session Sidebar**: Visual list of all open terminal sessions
- **Shell Quick-Launch**: Buttons to quickly open new tabs with different shells (PowerShell, Git Bash, CMD, etc.)
- **Keyboard Shortcuts**: Configurable hotkeys for launching specific shells
- **Git Integration**: Shows current branch and dirty file count for each session
- **Activity Indicators**: Visual notification when background sessions have new output
- **Smart CWD Detection**: Multiple pattern matching strategies for detecting current working directory
- **Shell Icons**: Nerd Font icons for different shell types
- **Theme Integration**: Automatically inherits colors from your Hyper theme

## Installation

### From npm (when published)

```bash
hyper i hyper-agent-session-sidebar
```

### As a local plugin

Clone or copy the plugin folder to:

```
~/.hyper_plugins/local/hyper-agent-session-sidebar/
```

Then add it to your `.hyper.js`:

```javascript
localPlugins: ["hyper-agent-session-sidebar"],
```

## Configuration

Add the following to your `.hyper.js` config:

```javascript
module.exports = {
  config: {
    // Shell definitions for quick-launch buttons
    shells: [
      {
        name: 'PowerShell 5',
        shell: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        shortcut: '1',
        default: true,
      },
      {
        name: 'Git Bash',
        shell: 'C:\\Users\\username\\AppData\\Local\\Programs\\Git\\bin\\bash.exe',
        args: ['--login', '-i'],
        shortcut: '2',
      },
      {
        name: 'CMD',
        shell: 'C:\\Windows\\System32\\cmd.exe',
        shortcut: '3',
      },
    ],

    // Keyboard shortcut modifier for shell launching
    selectShellKeymap: 'ctrl+shift',

    // Sidebar configuration
    sessionSidebar: {
      width: 220,              // Sidebar width in pixels
      position: 'left',        // 'left' or 'right'
      showGit: true,           // Show git branch and dirty status
      showCwd: true,           // Show current working directory
      showShellLauncher: true, // Show shell quick-launch buttons
      showPid: true,           // Show process ID in status bar
      activityTimeout: 3000,   // How long activity indicator shows (ms)
      opacity: 0.9,            // Sidebar opacity when not hovered
      opacityHover: 1,         // Sidebar opacity when hovered
    },
  },
};
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `width` | number | `220` | Sidebar width in pixels |
| `position` | string | `'left'` | Sidebar position: `'left'` or `'right'` |
| `showGit` | boolean | `true` | Show git branch and dirty file count |
| `showCwd` | boolean | `true` | Show current working directory |
| `showShellLauncher` | boolean | `true` | Show shell quick-launch buttons |
| `showPid` | boolean | `true` | Show process ID in status bar |
| `activityTimeout` | number | `3000` | Duration to show activity indicator (ms) |
| `opacity` | number | `0.9` | Sidebar opacity (0-1) |
| `opacityHover` | number | `1` | Sidebar opacity on hover (0-1) |
| `theme` | object | `{}` | Theme color overrides |

### Shell Configuration

Each shell in the `shells` array can have:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | string | Yes | Display name for the shell |
| `shell` | string | Yes | Full path to the shell executable |
| `args` | array | No | Command line arguments |
| `shortcut` | string | No | Key to combine with `selectShellKeymap` |
| `default` | boolean | No | Set as the default shell |

## CWD Detection

The plugin uses an extensible pattern-matching system to detect the current working directory from terminal output. Patterns are tried in order:

| Pattern | Description |
|---------|-------------|
| OSC 7 | Standard terminal CWD escape sequence |
| OSC 9;9 | Windows Terminal style CWD escape sequence |
| MINGW | Git Bash MINGW prompt with path |
| PS Prompt | Standard PowerShell `PS path>` prompt |
| CMD Prompt | Standard CMD `path>` prompt |
| Directory Output | PowerShell `dir`/`Get-ChildItem` output |
| Tilde Prompt | Custom prompts with `~` paths (Oh My Posh, Starship) |
| Full Windows Path | Full `C:\path` in colored prompts |
| Unix Path | Git Bash Unix-style `/c/path` format |

### Adding Custom Patterns

The pattern system is designed to be extensible. Each pattern in `cwdPatterns` array has:

```javascript
{
  name: 'Pattern Name',      // For logging
  description: '...',        // Documentation
  regex: /pattern/,          // Regex to match (capture group 1 = path)
  transform: (match) => {},  // Optional: transform the matched path
  skipIf: (path) => {},      // Optional: skip condition (return true to skip)
}
```

## Keyboard Shortcuts

With the example configuration:

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+1` | Open new PowerShell tab |
| `Ctrl+Shift+2` | Open new Git Bash tab |
| `Ctrl+Shift+3` | Open new CMD tab |

## Requirements

- [Hyper](https://hyper.is/) terminal
- [Nerd Font](https://www.nerdfonts.com/) for icons (e.g., FiraCode Nerd Font)

## Development

### Enable Debug Logging

Edit `index.js` and set:

```javascript
const DEV_LOGGING = true;
```

Logs are written to `debug.log` in the plugin directory.

### Monitor Logs (PowerShell)

```powershell
Get-Content "path\to\debug.log" -Wait -Tail 20
```

### Monitor Logs (Bash)

```bash
tail -f path/to/debug.log
```

## Troubleshooting

### Buttons not appearing

1. Ensure `shells` array is defined in your config
2. Ensure `showShellLauncher` is `true` (or not set)
3. Restart Hyper completely (not just reload config)
4. Check DevTools console (`Ctrl+Shift+I`) for errors

### Icons not showing

Install a Nerd Font and set it in your Hyper config:

```javascript
fontFamily: '"FiraCode Nerd Font", Consolas, monospace',
```

### CWD not updating

- The plugin parses terminal output to detect paths
- Works best with custom prompts (Oh My Posh, Starship) that display the path
- Running `dir` or `ls` will also trigger CWD detection from output
- Check debug logs to see which patterns are matching

### Git info not updating

Git information is debounced (500ms) and only checks when the working directory changes.

## License

MIT
