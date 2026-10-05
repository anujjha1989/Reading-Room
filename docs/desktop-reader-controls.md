# Desktop reader controls

The Mac/browser reader uses the same page, menu and narration actions as iOS.
Book documents remain sandboxed; host controls handle input in Safari as well
as Chrome. The touch gestures and visible glass controls are unchanged.

| On iPhone | Mouse / keyboard |
| --- | --- |
| Tap the left/right page edge; swipe in Pages mode | Click the same edge; Left/Right or Page Up/Down |
| Scroll the book | Mouse wheel/trackpad; Up/Down; Space advances, Shift+Space goes back |
| Tap the middle to show/hide controls | Click the middle |
| Tap the reading menu | Click it, or M; Tab then Enter also works |
| Long-press text to select/highlight | Double-click a word, or drag across text; same selection menu |
| Tap a link or saved highlight | Click it |
| Tap narration transport or return-to-reading | Click it, or Tab then Enter/Space |
| Tap the sleep timer to add 30 minutes | Click it, or Tab then Enter/Space |
| Hold the sleep timer three seconds to cancel | Hold the mouse, or focus it and press Shift+Enter |
| Close a panel or book | Escape steps back through menus, then closes the book |

Page shortcuts leave focused buttons, text fields, modifiers and active text
selections alone. In Scroll mode they advance the viewport, not jump straight
to a different chapter. Desktop input is covered by `desktop-reader-input`
browser checks in both Chrome and WebKit, in Pages and Scroll modes.
