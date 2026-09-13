# 吉祥物素材生成紀錄

使用內建 imagegen；未使用 Higgsfield 付費影片生成或 CLI API。
參考：使用者提供的 `S__90791959.jpg`，以及既有 `hacker-room.png`。
輸出均另存，未覆寫原始參考圖片。

- 場景：`assets/mascot-room.png`（1672 × 941）
- 打字影格 B：`assets/mascot-typing.png`（1672 × 941）

前端只顯示影格 B 的前臂範圍，避免整個場景跳動。

## 場景提示詞

Use case: precise-object-edit / compositing. Edit image 1 (1280x720 cyberpunk website background). Image 2 is the user's official squirrel mascot identity reference. Replace ONLY the hoodie cat on the right with this exact cute cybersecurity squirrel mascot, seated on the same chair operating the same keyboard: purple/magenta head and huge curled tail, ice-blue face and belly, enormous teal eyes with white highlights, teal headphones, teal baseball cap bearing shield and small padlock and wifi signal above. Faithfully preserve mascot identity, colors, round proportions and thick dark comic outlines. No hoodie. Both ice blue paws reach left to the keyboard at approx x890-975,y520-568 of original image1, visibly typing. Position large curled purple tail at far right behind mascot, fit in frame. Keep image1 computer screen, desk, keyboard, monitor perspective, cables and server room geometry EXACTLY unchanged. Screen four corners remain x681 y216, x802 y261, x834 y473, x724 y486 in a 1280x720 coordinate system. Left half remains dark empty navy background, REMOVE the large existing Chinese text completely (webpage will render real text). No new text anywhere, no logos added. Monitor glass blank dark navy, no generated letters. Flat hand-drawn 2D cel shaded comic, dark blue room and cyan rim lighting. Not 3D. Produce one finished landscape 16:9 background, preserve the original scene framing.

## 打字影格 B 提示詞

Use case: precise-object-edit. This is frame B of a two-frame typing animation for a website. Keep the ENTIRE image absolutely unchanged in exact placement, resolution, canvas, colors, outline style, squirrel face/eyes/hat/headphones/tail, monitor, room, keyboard, desk. ONLY change the two forearms and paws in the small rectangle approximately x1120 to1385 and y610 to740 of the 1672x941 source. Make typing visibly alternate: the nearer paw currently on the keyboard (lower/right paw around x1200,y710) lifts 12 pixels up with fingers lightly curled, while the farther paw (upper/left paw around1155,680) presses keys 5 pixels down. The arms bend naturally to connect to the unchanged shoulders. Tiny, clear motion, same thick dark ink outlines, same ice-blue fur. Absolutely no other changes or added action lines or text. Do not move or resize the mascot or camera. Preserve source framing exactly. Output the same 16:9 scene, only the typing hand poses changed.
