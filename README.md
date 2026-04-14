<p align="center">
  <img src="public/logo.png" alt="PDF Presenter" width="120">
</p>

<h1 align="center">PDF Presenter</h1>

<p align="center">
  Aplicación de escritorio para presentaciones PDF con control remoto desde el móvil, vista de presentador y herramientas de anotación en tiempo real.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-28-47848F?logo=electron" alt="Electron">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/License-MIT-blue" alt="License">
</p>

---

## Características

- **Presentación a pantalla completa** — Renderiza PDFs en pantalla externa con transiciones fluidas
- **Vista de presentador** — Diapositiva actual, siguiente, notas del orador y temporizador
- **Control remoto móvil** — Controla la presentación desde tu teléfono escaneando un QR
- **Herramientas de anotación** — Linterna, dibujo libre, puntero láser y zoom
- **Notas del presentador** — Importa notas desde archivos PowerPoint (.pptx)
- **Vídeos de YouTube** — Incrusta vídeos de YouTube sobre cualquier diapositiva
- **Organización** — Carpetas, búsqueda y ordenación de presentaciones
- **Multiidioma** — Interfaz en español e inglés

---

## Requisitos previos

- [Node.js](https://nodejs.org/) v18 o superior
- [npm](https://www.npmjs.com/) (incluido con Node.js)

---

## Instalación

```bash
# 1. Clona el repositorio
git clone <url-del-repositorio>
cd pdfpresenter

# 2. Instala las dependencias
npm install
```

---

## Uso

### Iniciar la aplicación

```bash
npm start
```

Esto abre la ventana principal de Electron y levanta un servidor local en el puerto **3491** para el control remoto.

### Modo desarrollo

```bash
npm run dev
```

### Ejecutar tests

```bash
npm test
```

---

## Cómo funciona

```
┌─────────────┐       WebSocket        ┌──────────────────┐
│   Móvil     │ ◄───────────────────► │  Servidor Express │
│  (Navegador)│                        │  puerto 3491      │
└─────────────┘                        └────────┬─────────┘
                                                │ IPC
                                ┌───────────────┼───────────────┐
                                ▼               ▼               ▼
                         ┌────────────┐ ┌─────────────┐ ┌────────────────┐
                         │  Ventana   │ │ Presentación│ │    Vista de    │
                         │  Principal │ │ (Audiencia) │ │  Presentador   │
                         └────────────┘ └─────────────┘ └────────────────┘
```

1. **Importa un PDF** desde la ventana principal
2. **Inicia la presentación** — se abre en pantalla completa (pantalla externa si hay dos)
3. **Activa el modo presentador** — verás la diapositiva actual, la siguiente y tus notas
4. **Escanea el código QR** con tu móvil para controlar la presentación de forma remota

---

## Herramientas de presentación

| Herramienta | Atajo | Descripción |
|-------------|-------|-------------|
| Linterna | `Cmd+L` | Oscurece todo excepto un área circular |
| Dibujo | `Cmd+D` | Dibuja sobre la diapositiva en tiempo real |
| Puntero | `Cmd+P` | Muestra un punto láser visible |
| Zoom | `Cmd+Z` | Lente de aumento sobre la diapositiva |

---

## Estructura del proyecto

```
pdfpresenter/
├── main.js              # Proceso principal de Electron
├── preload.js           # Puente seguro entre procesos
├── server.js            # Servidor Express + WebSocket
├── package.json
├── public/
│   └── logo.png         # Logo de la aplicación
├── src/
│   ├── index.html       # Ventana principal (gestión de PDFs)
│   ├── presentation.html # Vista de audiencia (pantalla completa)
│   ├── presenter.html   # Vista de presentador
│   ├── js/
│   │   ├── i18n.js      # Sistema de internacionalización
│   │   ├── pptx-parser.js # Extractor de notas de PowerPoint
│   │   └── renderer.js  # Lógica de la ventana principal
│   ├── mobile/
│   │   ├── index.html   # Interfaz del control remoto
│   │   ├── app.js       # Lógica del control remoto
│   │   └── style.css    # Estilos del móvil
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

## Tecnologías

| Tecnología | Uso |
|-----------|-----|
| [Electron](https://www.electronjs.org/) | Aplicación de escritorio multiplataforma |
| [Express](https://expressjs.com/) | Servidor HTTP para API y contenido estático |
| [WebSocket (ws)](https://github.com/websockets/ws) | Comunicación en tiempo real con el móvil |
| [PDF.js](https://mozilla.github.io/pdf.js/) | Renderizado de PDFs en el navegador |
| [JSZip](https://stuk.github.io/jszip/) | Lectura de archivos .pptx (ZIP) |
| [QRCode](https://github.com/soldair/node-qrcode) | Generación de códigos QR |

---

## Licencia

MIT
