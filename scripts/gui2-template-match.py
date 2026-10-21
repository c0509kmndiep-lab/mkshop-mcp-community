#!/usr/bin/env python
"""Conservative screenshot template locator for WinApp screenshots; no UI input."""
import ctypes
import json
import sys

try:
    import cv2
except ImportError as e:
    raise SystemExit("opencv-python is required: " + str(e))

class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                ("right", ctypes.c_long), ("bottom", ctypes.c_long)]

def main():
    hwnd, screenshot, template = int(sys.argv[1]), sys.argv[2], sys.argv[3]
    image = cv2.imread(screenshot, cv2.IMREAD_GRAYSCALE)
    patch = cv2.imread(template, cv2.IMREAD_GRAYSCALE)
    if image is None or patch is None:
        raise ValueError("Unreadable screenshot or template")
    ih, iw = image.shape
    ph, pw = patch.shape
    if not (8 <= pw <= min(512, iw) and 8 <= ph <= min(512, ih)):
        raise ValueError("Template must be 8..512px and fit screenshot")
    if float(patch.std()) < 10.0:
        raise ValueError("Template lacks contrast, refusing unreliable match")
    result = cv2.matchTemplate(image, patch, cv2.TM_CCOEFF_NORMED)
    _, best, _, at = cv2.minMaxLoc(result)
    # Suppress neighborhood around strongest match to find other plausible matches.
    x, y = at
    margin_x, margin_y = max(6, pw // 2), max(6, ph // 2)
    x0, x1 = max(0, x-margin_x), min(result.shape[1], x+margin_x+1)
    y0, y1 = max(0, y-margin_y), min(result.shape[0], y+margin_y+1)
    result[y0:y1, x0:x1] = -1.0
    _, runner_up, _, _ = cv2.minMaxLoc(result)
    rect = RECT()
    if not ctypes.windll.user32.GetWindowRect(hwnd, ctypes.byref(rect)):
        raise ValueError("GetWindowRect failed")
    rw, rh = rect.right-rect.left, rect.bottom-rect.top
    # DWM captures may include/exclude some shadow pixels. Require exact-enough mapping for clicking.
    aligned = abs(rw-iw) <= 4 and abs(rh-ih) <= 4
    print(json.dumps({
        "score":round(float(best),5), "runnerUp":round(float(runner_up),5),
        "relativeX":x+pw//2, "relativeY":y+ph//2,
        "x":rect.left+x+pw//2, "y":rect.top+y+ph//2,
        "width":pw, "height":ph, "screenWidth":iw, "screenHeight":ih,
        "windowRect":[rect.left,rect.top,rect.right,rect.bottom],
        "geometryAligned":aligned,
        "reliable":bool(best >= 0.94 and (best-runner_up) >= 0.035 and aligned),
    }, ensure_ascii=False))

if __name__ == '__main__':
    try:
        main()
    except Exception as err:
        sys.stderr.write(str(err) + "\n")
        sys.exit(2)
