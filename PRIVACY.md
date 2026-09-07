# Privacy Policy

**Offline Autofill**

Last updated: 3 September 2026

## Summary

Offline Autofill does not collect, transmit, store on any server, or sell any personal data.
There are no analytics, no error reporting, no accounts, and no servers operated by the developer.
The extension communicates only with software running on your own computer.

## What the extension stores

Your profile - the name, contact details, addresses, education, and employment history you enter, and the answers you choose to save from forms you filled - is stored in your browser's extension storage on your device.
It is isolated from web pages and from other extensions.
It is not uploaded anywhere, and the developer has no access to it.

In this version the profile is stored as plain data, protected by your operating system's user account and disk encryption rather than by a separate passphrase.
Passphrase encryption is planned.

Documents you add (a resume, a cover letter, a transcript, a photo) are stored the same way: the file itself, its name and type, the kind you assigned, and any description you typed.
Each file may be up to 10 MB; the extension asks for the `unlimitedStorage` permission so that a few such files fit.

Settings (the selected engine, its localhost address, the model name, and the filling options) are stored the same way.

Removing the extension deletes all of it.

## What the extension accesses

When you click **Scan this page**, the extension reads the structure of the form on that page: field labels, names, types, dropdown options, and the labels and accepted file types of its upload controls.
To describe the form, it also reads the page title, headings, paragraph text, button labels, and the labels of file-upload controls.
This happens on your device.

If you have enabled a local model, the fields the built-in rules could not recognize are described to a local inference server that you run yourself, at an address on `localhost` or `127.0.0.1` that you configure in the extension's settings.
For each such field that description is its label, its `name` or `id` attribute, its type, the heading of its section, and its dropdown options.
With the form summary switched on (the default), the page title, headings, paragraph text, button labels, and the labels of file-upload controls are sent to that same local server so it can describe the form, together with each fillable field's label, type, section heading, and whether it is required (the first 40 fields; beyond that only a count of the rest).
A field without a label is named by its ARIA label, placeholder, or the prose beside it, and failing those by its `name` attribute.
Upload controls the built-in rules could not place are described to that server by their label, `name` or `id`, accepted file types, and section heading, so it can say which kind of document (resume, cover letter, transcript, and so on) each asks for.
Your documents themselves, their file names, and your descriptions of them are never sent to the model.
The questions of your saved answers are sent to the model as part of the vocabulary it may choose from, so it can recognize the same question on another form; the answers themselves are never sent.
Fields the extension refuses to fill (passwords, one-time codes, payment cards, bank accounts, government identifiers) are described to the model only by kind ("a password"), never by label or name.
Page text can contain personal information the page itself shows; that text stays on your machine, but it does reach the local server you chose.
Examples are Ollama, LM Studio, and a llama.cpp server.
That server is on your machine, under your control, and is not operated by the developer of this extension.
**Your profile values are never included in what is sent to the model.**

When you click **Fill**, the values you reviewed are written into the page's form fields, and the documents you reviewed are handed to the page's upload controls, exactly as if you had chosen them in the file dialog.
That is the only time profile data or a document reaches a web page, and only into the fields you left selected.
The page then does with the file what it would do with any upload; the extension does not control where the site sends it.

When you click **Save answers**, the extension reads the current values of the form fields it could fill on that page - the same visible, editable fields a scan would offer, never a password, code, card, bank account, or identifier field - and lists them for review.
Nothing is stored until you choose which ones to keep and confirm; the rest are discarded.
That is the only time a value from a page enters the extension, and it never leaves your device or reaches the model.

No page content, no profile data, no prompt, and no metadata is ever sent to the developer or to any third party.

The extension declares access only to `localhost` and `127.0.0.1`.
It requests no other hosts.
In addition, the address you configure is checked against a list of local hostnames before every request, so nothing can be sent to a remote server even if the stored setting were altered.

## Permissions

- **`activeTab` and `scripting`** let the extension read the form fields of the page you asked it to fill, write your reviewed values into them, and read what you typed when you click **Save answers**.
- **`webNavigation`** lets the extension list the frames of that one page, because application forms are often embedded from another site (a company careers page showing a Greenhouse or Lever form).
  It is used only when you scan or fill, only for the tab you are looking at, and only to find the frames to ask; the addresses it returns are not kept, shown, or sent anywhere.
  Chrome describes this permission as "Read your browsing history"; the extension reads no history.
- **`storage`** keeps your profile, documents, and settings, as described above.
- **`unlimitedStorage`** lets the stored documents exceed the browser's default 10 MB allowance for extension storage.
- **`sidePanel`** displays the extension's own interface. It does not read page content.
- **Access to `localhost` and `127.0.0.1`** lets the extension reach the local inference server you run.

The extension's content script is registered for all sites, because you may ask to fill a form on any page.
It reads form structure, reads typed values, and writes values only when you ask it to from the panel.

## Third parties

There are none.
No data is shared with, sold to, or transferred to any third party, and none is used for advertising, profiling, or creditworthiness.

## Children

The extension collects no data from anyone, including children.

## Changes

Any change to this policy will be published in this file, in the extension's public repository, with an updated date above.

## Contact

Questions or concerns: https://github.com/dkobia/offline-autofill/issues
