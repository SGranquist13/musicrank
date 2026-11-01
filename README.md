# MusicRank

Listen through an artist's **entire discography** and rank every album and every song. A clean static site with no build step and no API keys.

- Search any artist and see every release with artwork, in release order
- Listen wherever you like (Spotify, Apple Music and YouTube Music links on every album) and tap S–F on each song as it plays
- Rank albums and songs by dragging them or using the arrow buttons. Rank tracks within each album too
- Drag-or-tap tier list boards for albums and songs, with "Order by tier" to seed rankings
- Copy a ranking as text to share it
- Everything is saved in your browser (localStorage)

Data comes from the public iTunes Search API.

## Hosting on GitHub Pages
Repo **Settings → Pages → Build and deployment → Deploy from a branch**, then choose `main` and `/ (root)`.
The site will be at `https://<user>.github.io/musicrank/`.

Run it locally with `python3 -m http.server`.
