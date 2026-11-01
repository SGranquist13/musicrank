# MusicRank

Listen through an artist's **entire discography** and rank every album and every song. A clean static site with no build step and no API keys.

- Search any artist and see every release with artwork, in release order
- Play 30-second previews, with auto-advance and "play all"
- Rank albums and songs by dragging them or using the arrow buttons. Rank tracks within each album too
- 1–5 star ratings, listened checkboxes and progress through the discography
- Copy a ranking as text to share it
- Everything is saved in your browser (localStorage)

Data comes from the public iTunes Search API.

## Hosting on GitHub Pages
Repo **Settings → Pages → Build and deployment → Deploy from a branch**, then choose `main` and `/ (root)`.
The site will be at `https://<user>.github.io/musicrank/`.

Run it locally with `python3 -m http.server`.
