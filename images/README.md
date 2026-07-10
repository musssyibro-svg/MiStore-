# images/

This directory is for product photos used by the site. I added this README to explain how to add and reference images without changing the site markup.

How to add product pictures
- Upload image files to this folder (example paths: `images/product1.jpg`, `images/iphone17-front.webp`).
- Keep file names descriptive and web-friendly (JPEG, WEBP, PNG). Aim for < 2–3 MB per file for best loading performance.
- Do NOT modify or overwrite `index.html` unless you explicitly want to change product image paths — the site already references `images/...` paths where appropriate.

Quick upload via GitHub web UI
1. Open the repository on GitHub and press `.` to open the web editor, or go to the repo page and click Add file → Upload files.
2. Create or drag your image files into the `images/` folder.
3. Commit the changes.

Notes
- I created a `.gitkeep` file so the folder exists in the repo even when empty.
- If you want, I can later add example image tags to a copy of `index.html` (never modifying your live file) so you can see how to reference uploaded images.