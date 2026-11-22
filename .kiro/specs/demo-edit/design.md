# Design: demo video edit

- `video/edit/talk.py`: TAKES list of (recording, start, end, picture). Snaps cuts to energy minima, joins with xfade 0.3 s, writes `talk_map.json`.
- `video/edit/compose.py`: ffmpeg filtergraph. Ghost-pattern background, rounded card, captions (ASS), section cards, QR panels, proof card, clips, music with sidechain ducking, loudnorm. `TEST_T` env renders a short test.
