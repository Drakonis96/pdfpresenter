const http = require('http');
const WebSocket = require('ws');
const os = require('os');
const path = require('path');

let serverModule;
let serverInfo;

beforeAll(async () => {
  serverModule = require('../server');
  const tmpDir = path.join(os.tmpdir(), 'pdfpresenter-test-' + Date.now());
  serverInfo = await serverModule.startServer(tmpDir);
}, 15000);

afterAll(async () => {
  serverModule.stopServer();
  await new Promise(r => setTimeout(r, 300));
});

describe('Server Module', () => {
  describe('Exports', () => {
    test('exports all required functions', () => {
      expect(typeof serverModule.startServer).toBe('function');
      expect(typeof serverModule.stopServer).toBe('function');
      expect(typeof serverModule.getServerInfo).toBe('function');
      expect(typeof serverModule.updateState).toBe('function');
      expect(typeof serverModule.setElectronCallback).toBe('function');
      expect(typeof serverModule.broadcast).toBe('function');
      expect(typeof serverModule.getCurrentState).toBe('function');
    });
  });

  describe('State Management', () => {
    test('initial state has expected defaults', () => {
      const state = serverModule.getCurrentState();
      expect(state).toHaveProperty('presenting');
      expect(state).toHaveProperty('pdfId');
      expect(state).toHaveProperty('currentSlide');
      expect(state).toHaveProperty('totalSlides');
      expect(state).toHaveProperty('notes');
      expect(state).toHaveProperty('videos');
      expect(state).toHaveProperty('toolMode');
    });

    test('updateState merges partial state', () => {
      serverModule.updateState({ presenting: true, pdfId: 'test123', totalSlides: 10 });
      const state = serverModule.getCurrentState();
      expect(state.presenting).toBe(true);
      expect(state.pdfId).toBe('test123');
      expect(state.totalSlides).toBe(10);
    });

    test('updateState updates slide number', () => {
      serverModule.updateState({ currentSlide: 5 });
      const state = serverModule.getCurrentState();
      expect(state.currentSlide).toBe(5);
    });
  });

  describe('HTTP Server', () => {
    test('starts on expected port', () => {
      expect(serverInfo).toHaveProperty('ip');
      expect(serverInfo).toHaveProperty('port', 3491);
    });

    test('getServerInfo returns server details', () => {
      const info = serverModule.getServerInfo();
      expect(info).not.toBeNull();
      expect(info).toHaveProperty('ip');
      expect(info).toHaveProperty('port', 3491);
      expect(info).toHaveProperty('url');
      expect(info.url).toContain('/mobile/');
    });

    test('GET /api/state returns current state', (done) => {
      http.get(`http://127.0.0.1:${serverInfo.port}/api/state`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const state = JSON.parse(data);
          expect(state).toHaveProperty('presenting');
          expect(state).toHaveProperty('currentSlide');
          expect(state).toHaveProperty('totalSlides');
          done();
        });
      });
    });

    test('GET /api/qr returns QR code data', (done) => {
      http.get(`http://127.0.0.1:${serverInfo.port}/api/qr`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const result = JSON.parse(data);
          expect(result).toHaveProperty('qr');
          expect(result).toHaveProperty('url');
          expect(result).toHaveProperty('ip');
          expect(result.qr).toMatch(/^data:image\/png;base64,/);
          done();
        });
      });
    });

    test('GET /api/presentations returns empty list', (done) => {
      http.get(`http://127.0.0.1:${serverInfo.port}/api/presentations`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const result = JSON.parse(data);
          expect(result).toHaveProperty('presentations');
          expect(result).toHaveProperty('folders');
          expect(Array.isArray(result.presentations)).toBe(true);
          done();
        });
      });
    });

    test('GET /api/pdf/:id returns 404 for non-existent PDF', (done) => {
      http.get(`http://127.0.0.1:${serverInfo.port}/api/pdf/nonexistent`, (res) => {
        expect(res.statusCode).toBe(404);
        done();
      });
    });
  });

  describe('WebSocket', () => {
    afterEach(() => {
      serverModule.setElectronCallback(null);
    });

    test('connects and receives initial state', (done) => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverInfo.port}`);
      ws.on('message', (data) => {
        const msg = JSON.parse(data);
        expect(msg).toHaveProperty('type', 'state');
        expect(msg).toHaveProperty('data');
        expect(msg.data).toHaveProperty('currentSlide');
        ws.close();
        done();
      });
    });

    test('handles navigate message', (done) => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverInfo.port}`);
      let msgCount = 0;
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'navigate', slide: 3 }));
      });
      ws.on('message', (data) => {
        msgCount++;
        if (msgCount >= 2) {
          const msg = JSON.parse(data);
          expect(msg.data.currentSlide).toBe(3);
          ws.close();
          done();
        }
      });
    });

    test('handles tool message', (done) => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverInfo.port}`);
      let msgCount = 0;
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'tool', tool: 'flashlight' }));
      });
      ws.on('message', (data) => {
        msgCount++;
        if (msgCount >= 2) {
          const msg = JSON.parse(data);
          expect(msg.data.toolMode).toBe('flashlight');
          ws.close();
          done();
        }
      });
    });

    test('broadcasts to other clients', (done) => {
      const ws1 = new WebSocket(`ws://127.0.0.1:${serverInfo.port}`);
      ws1.on('open', () => {
        const ws2 = new WebSocket(`ws://127.0.0.1:${serverInfo.port}`);
        let ws2Msgs = 0;
        ws2.on('message', (data) => {
          ws2Msgs++;
          if (ws2Msgs === 2) {
            const msg = JSON.parse(data);
            expect(msg.data.currentSlide).toBe(7);
            ws1.close();
            ws2.close();
            done();
          }
        });
        ws2.on('open', () => {
          ws1.send(JSON.stringify({ type: 'navigate', slide: 7 }));
        });
      });
    }, 10000);
  });

  describe('Electron Callback', () => {
    test('receives events via callback', (done) => {
      serverModule.setElectronCallback((action, data) => {
        expect(action).toBe('navigate');
        expect(data).toBe(2);
        serverModule.setElectronCallback(null);
        done();
      });

      const ws = new WebSocket(`ws://127.0.0.1:${serverInfo.port}`);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'navigate', slide: 2 }));
        setTimeout(() => ws.close(), 100);
      });
    }, 10000);
  });
});
