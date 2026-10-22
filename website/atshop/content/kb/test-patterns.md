---
summary: Full-screen test patterns for projectors, LED walls and monitors, on any screen, with no sign-in.
audience: techs
keywords: test pattern, colour bars, screentest, gradient, checkerboard, crosshatch, geometry, sharpness, overscan, led tile map, projector alignment, focus
---
# Test patterns

`http://SERVER:8080/screentest` shows full-screen test patterns on any screen, with no sign-in. Use them to line up a projector, focus it, check an LED wall's tiles or check a scaler isn't cropping the picture.

![Colour bars full screen, with the Screen test bar at the top and a box of resolution and scale details](/static/kb/screen-testpattern.jpg)

## The patterns

| Pattern | Use it to check |
|---|---|
| Solid black | Light leaks, dead pixels, the black level |
| Colour bars | Colour, a swapped or missing colour channel |
| Grey gradient | Banding and contrast |
| RGB gradient | Each colour channel on its own |
| Pixel checkerboard | That the signal is pixel for pixel, not scaled |
| Crosshatch and geometry | Projector alignment, keystone and lens shift |
| Sharpness and text | Focus, across the whole picture |
| Motion line | Smooth movement and dropped frames |
| Overscan border | That nothing is cropped at the edges |
| LED tile map | An LED wall's tiles, numbered (set the columns and rows) |

## Keys

<kbd>→</kbd> or <kbd>Space</kbd> next pattern, <kbd>←</kbd> previous, <kbd>+</kbd> and <kbd>−</kbd> adjust (like the LED map's columns), <kbd>I</kbd> shows the resolution and scale, <kbd>F</kbd> full screen. The bar hides when the mouse is still.

## Send a pattern to a stage screen

When you [add a screen](/docs/pair-a-screen), or later in the workspace's **Screens** window or **Timers → Screens**, pick a test pattern as what it shows. Remember to put the timer back afterwards.
