import cv2, numpy as np
src = cv2.imread('/home/yousefmsm1/Downloads/Haunted Crew Neon Library Footer.png')
h, w = src.shape[:2]
x0, x1, y0, y1 = 255, 1800, 268, 652  # baked UI area (logo, links, socials, divider, copyright)
roi = src[y0:y1, x0:x1]
lum = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
m = ((lum > 48) | ((hsv[..., 1] > 90) & (hsv[..., 2] > 60))).astype(np.uint8) * 255
m = cv2.dilate(m, np.ones((7, 7), np.uint8), iterations=2)
mask = np.zeros((h, w), np.uint8); mask[y0:y1, x0:x1] = m
out = cv2.inpaint(src, mask, 9, cv2.INPAINT_TELEA)
cv2.imwrite('gen/footer_mask.png', mask)
cv2.imwrite('gen/footer_clean.png', out)
print('masked px', int((mask > 0).sum()))
# second pass: leftover social button boxes and divider lines, masked as full rects
mask2 = np.zeros((h, w), np.uint8)
for (a, b, c, d) in [(372, 716, 430, 512), (790, 816, 295, 510), (565, 1590, 548, 590)]:
    mask2[c:d, a:b] = 255
out = cv2.inpaint(out, mask2, 15, cv2.INPAINT_TELEA)
cv2.imwrite('gen/footer_clean.png', out)
