<p align="center">
  <img src="public/logo.png" alt="PDF Presenter" width="120">
</p>

<h1 align="center">PDF Presenter</h1>

<p align="center">
  Desktop application for PDF presentations with mobile remote control, presenter view, and real-time annotation tools.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-28-47848F?logo=electron" alt="Electron">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/License-MIT-blue" alt="License">
</p>

---

## Features

- **Full screen presentation** — Renders PDFs on an external display with smooth transitions
- **Presenter view** — Current slide, next slide, speaker notes, and timer
- **Mobile remote control** — Control the presentation from your phone by scanning a QR code
- **Annotation tools** — Flashlight, freehand drawing, laser pointer, and zoom
- **Presenter notes** — Import notes from PowerPoint (.pptx) files
- **YouTube videos** — Embed YouTube videos over any slide
- **Organization** — Folders, search, and sorting for presentations
- **Multi-language** — Interface in Spanish and English

---

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- [npm](https://www.npmjs.com/) (included with Node.js)

---

## Installation

```bash
# 1. Clone the repository
git clone <repository-url>
cd pdfpresenter

# 2. Install dependencies
npm install
```

---

## Usage

### Start the application

```bash
npm start
```

This opens the main Electron window and starts a local server on port **3491** for remote control.

### Development mode

```bash
npm run dev
```

### Run tests

```bash
npm test
```

---

## How it works

```
┌─────────────┐       WebSocket        ┌──────────────────┐
│   Mobile    │ ◄───────────────────► │  Express Server  │
│ (Browser)   │                        │  port 3491       │
└─────────────┘                        └────────┬─────────┘
                                                │ IPC
                                ┌───────────────┼───────────────┐
                                ▼               ▼               ▼
                         ┌────────────┐ ┌─────────────┐ ┌────────────────┐
                         │  Main      │ │ Presentation│ │   Presenter    │
                         │  Window    │ │ (Audience)  │ │     View       │
                         └────────────┘ └─────────────┘ └────────────────┘
```

1. **Import a PDF** from the main window
2. **Start the presentation** — opens in full screen (external display if two are connected)
3. **Activate presenter mode** — see current slide, next slide, and your notes
4. **Scan the QR code** with your phone to control the presentation remotely

---

## Presentation Tools

| Tool      | Shortcut | Description                              |
|-----------|----------|------------------------------------------|
| Flashlight| `Cmd+L`  | Dims everything except a circular area   |
| Draw      | `Cmd+D`  | Draw on the slide in real time           |
| Pointer   | `Cmd+P`  | Shows a visible laser dot                |
| Zoom      | `Cmd+Z`  | Magnifying lens over the slide           |

---

## Project Structure

```
pdfpresenter/
├── main.js              # Electron main process
├── preload.js           # Secure bridge between processes
├── server.js            # Express + WebSocket server
├── package.json
├── public/
│   └── logo.png         # App logo
├── src/
│   ├── index.html       # Main window (PDF management)
│   ├── presentation.html # Audience view (full screen)
│   ├── presenter.html   # Presenter view
│   ├── js/
│   │   ├── i18n.js      # Internationalization system
│   │   ├── pptx-parser.js # PowerPoint notes extractor
│   │   └── renderer.js  # Main window logic
│   ├── mobile/
│   │   ├── index.html   # Remote control interface
│   │   ├── app.js       # Remote control logic
│   │   └── style.css    # Mobile styles
│   └── styles/
│       ├── main.css
│       ├── presentation.css
│       └── presenter.css
└── tests/
    ├── server.test.js
    ├── pptx-parser.test.js
    └── i18n.test.js
```

---

## Technologies

| Technology | Purpose                                    |
|------------|--------------------------------------------|
| [Electron](https://www.electronjs.org/) | Cross-platform desktop app |
| [Express](https://expressjs.com/)      | HTTP server for API and static content |
| [WebSocket (ws)](https://github.com/websockets/ws) | Real-time communication with mobile |
| [PDF.js](https://mozilla.github.io/pdf.js/) | PDF rendering in the browser |
| [JSZip](https://stuk.github.io/jszip/) | Reading .pptx (ZIP) files |
| [QRCode](https://github.com/soldair/node-qrcode) | QR code generation |

---

## License

MIT
