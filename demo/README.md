# Demo

A job application page for a fictional company, Acme Corp, built to show everything Offline Autofill does on one form: profile fields, repeating sections, dropdowns, screening questions, document uploads, and a field it refuses to fill.
It is the page behind the store screenshots and the demo video.

Nothing here is real. Acme Corp does not exist, the applicant is invented, and the page has no backend: submitting it shows a confirmation and sends nothing anywhere.
The page loads no fonts, scripts, or images from the network, so it works from a local static server or straight from disk.

## What is in here

| Path | What it is |
| --- | --- |
| `index.html` | The application page. Open it in the browser, or serve the folder with any static server. |
| `profile.json` | The applicant's profile in the extension's stored shape, ready to load. |
| `documents/Tessa_Marlowe_Resume.pdf` | A one-page resume to add under Documents. |
| `documents/Tessa_Marlowe_Cover_Letter.pdf` | A one-page cover letter to add under Documents. |
| `documents/src/` | The HTML the PDFs are rendered from (`scripts/render-demo-documents.sh`). |
| `../scripts/demo-seed.mjs` | Prints a snippet that loads the profile and both PDFs into the extension in one paste. |

## Setting up the demo

1. Build and load the extension (see the README's quick start).

2. Load the profile and the documents. The quickest way is one paste into the extension's service worker console:

   ```sh
   node scripts/demo-seed.mjs | pbcopy
   ```

   Open `chrome://extensions`, click the extension's "service worker" link, paste, and press Enter. Firefox: `about:debugging`, "Inspect" next to the extension, then the same paste. The console replies "demo profile and documents loaded".

   By hand instead: type the values from `profile.json` into the Profile tab and save, then add the two PDFs under Documents. Their file names are recognized, so each lands under the right kind.

3. Serve the page and open it:

   ```sh
   python3 -m http.server 8000 --directory demo
   ```

   Then open <http://localhost:8000/>. Opening `index.html` straight from disk works too, but Chrome only runs extensions on `file://` pages when "Allow access to file URLs" is on for the extension in `chrome://extensions`.

4. Click **Scan this page** in the panel.

## What a scan shows

With the built-in rules alone:

- Name, email, phone, links, the full address (state and country dropdowns included), the education entry, and both work entries are planned from the profile.
- The resume and cover letter are planned for the two upload fields.
- The password field is refused and counted as such.
- The screening questions ("Why do you want to work at Acme?", work authorization, expected salary, earliest start date, how you heard about us), the pronouns dropdown, and the "Location" fields under Work experience are left unrecognized.

With a local model on, the model maps the "Location" fields to the employment location and explains the form in the summary; the screening questions still have no profile value and stay unrecognized until you answer them.

To show saved answers: fill the page, answer the screening questions by hand, click **Save answers**, keep the ticked ones, reload the page, and scan again. The questions are now filled from your answers.

## Screenshots and video

The layout is designed for a 1280 pixel wide window with the side panel open (about 900 pixels left for the page): the role summary sidebar drops away and the form takes the full column.
Keep the page light; the panel follows the system color scheme.
