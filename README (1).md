# Immersive Book

A static site. Upload these files to a GitHub repository and turn on GitHub Pages (see below).

## Deploy to GitHub Pages
1. Create a repository, for example `immersive-book`.
2. Upload all files in this folder to the repository root.
3. Repository Settings > Pages > Build and deployment > Source: "Deploy from a branch", Branch: `main`, Folder: `/ (root)`.
4. Open `https://<your-username>.github.io/immersive-book/` after the build finishes.

## Notes
- There is no build step and no server code.
- Bookmarks and progress are kept in the reader's browser (localStorage). Nothing is uploaded.
- Files are converted in the browser. PDF.js and mammoth are included in the repository root, so nothing is loaded from other sites.
- Supported formats are PDF, DOCX and TXT. PDF pages are rendered locally so images, diagrams and scanned pages remain visible; extracted text is also analysed for context-aware ambience.
- The reader includes page navigation, bookmarks, notes, progress saving, local ambience and standalone HTML export with embedded book images and sound data.
