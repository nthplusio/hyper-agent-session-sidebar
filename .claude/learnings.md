# Learnings

## SVG Icon Rendering in Hyper Plugins

### viewBox Case Sensitivity (Critical)
SVG attributes are case-sensitive. The `viewBox` attribute must remain exactly as `viewBox`, not `view-box`. When converting camelCase JavaScript property names to kebab-case for SVG attributes, preserve the casing for:
- `viewBox`
- `xmlns`

**Symptom**: Icons appear clipped, showing only the top-left corner
**Cause**: Invalid `view-box` attribute means no scaling, so 24x24 content renders at native size and gets clipped to container
**Fix**: Preserve case for special SVG attributes

```javascript
const preserveCase = ['viewBox', 'xmlns'];
const key = preserveCase.includes(k)
  ? k
  : k.replace(/([A-Z])/g, '-$1').toLowerCase();
```

### Lucide Icon Integration
- Lucide icons use a 24x24 viewBox coordinate system
- Set `width` and `height` attributes on the SVG element to scale
- Use `stroke: currentColor` to inherit color from parent
- Increase `stroke-width` (2.5) for better visibility at small sizes (< 18px)

### CSS for SVG Icons in React/Electron
When using `dangerouslySetInnerHTML` to render SVG icons:
1. Container needs explicit `width`, `height`, and `display: flex` for centering
2. Add SVG-specific CSS rules: `.container svg { width: X; height: X; }`
3. Don't rely on `font-size` for SVG sizing - it doesn't apply
4. For different view modes (compact/micro), define separate SVG sizing rules

### Icon Library Setup
Created `icons.js` module with:
- ICONS object containing SVG path data from Lucide
- `getIconSvg(name, size, attrs)` function for generating SVG markup
- SVG_DEFAULTS for consistent styling (fill: none, stroke: currentColor, etc.)
