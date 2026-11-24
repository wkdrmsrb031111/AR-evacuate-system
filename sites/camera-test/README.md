# AR Evacuate camera test

Camera-only static export of admin-web/camera.html. Contains no admin API, database, OCR models, or photo uploads. Imports validated route snapshots exported by the admin web; direction is registered per step, with a facing reference and user-confirmed arrival. Live route refresh, position tracking, and world-anchored AR are not implemented. Video and imported files stay on device.

The included fictional company route is a 20m snapshot calculated by the local backend. Straight/right directions are explicitly simulated and must not be followed in a real building. Source route timestamp and snapshot limitations are shown in the UI.

Sign AI verification uses browser-side Tesseract.js with self-hosted Korean/English models, worker, and WASM. General tests show one-frame text recognition. Routes may register optional facingSignText per step. After one AI-check button press, two updated camera frames must each match the entire normalized registered name before displaying that step's arrow without a manual checkbox. Generated sample photos never trigger it. Camera restart, new route, and step changes clear the match; stale jobs are ignored. This experimental text match does not measure position or heading. Video and images are not uploaded. Continuous scanning is not implemented.

Source: src/CameraGuide.tsx and src/CameraGuide.css. Built with the React/Vite setup in the parent project. Only camera and shared React runtime bundles are included in dist.
