# profile.kcrt.net

Source of <https://profile.kcrt.net/>, a static single page served by GitHub Pages.

## Files

| Path | Description |
|---|---|
| `index.html` | The page |
| `nano.css` / `nano.js` | Handmade, mostly classless stylesheet and its optional helpers (navbar menu) |
| `profile.css` | Site-specific styles |
| `icons.svg` | SVG sprite of the Font Awesome Free icons used in the page |
| `scripts/build_icons.py` | Regenerates `icons.svg` from the `icons.svg#<name>` references in `index.html` |
| `secret.js` / `secret/` | Hidden mode (click the profile photo 10 times): a 3D breakout game |

## Development

```sh
npx live-server            # preview with auto reload
./scripts/build_icons.py   # after adding/removing icons in index.html (requires uv)
```

The page must be served over HTTP (not `file://`) for the icon sprite and the hidden mode to work.

## Dependencies

| Name | Version | Where | License |
|---|---|---|---|
| [Font Awesome Free](https://fontawesome.com/) (icons only) | 5.15.4 | `icons.svg` | CC BY 4.0 |
| [three.js](https://threejs.org/) (`WebGPURenderer`, `BloomNode`, `RoomEnvironment`) | 0.187.0 | `secret/three/` (vendored, loaded only when the hidden mode starts) | MIT (`secret/three/LICENSE`) |
| ORCID iD icon | — | `orcid-id.svg` | ORCID trademark, used unmodified |
