const http = require('http');
const WebSocket = require('ws');
const os = require('os');
const path = require('path');
const fs = require('fs');

let serverModule;
let serverInfo;
let tmpDir;

beforeAll(async () => {
  serverModule = require('../server');
  tmpDir = path.join(os.tmpdir(), 'pdfpresenter-test-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });
  serverInfo = await serverModule.startServer(tmpDir, 0);
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
    test('starts on a dynamic port', () => {
      expect(serverInfo).toHaveProperty('ip');
      expect(serverInfo).toHaveProperty('port');
      expect(serverInfo.port).toBeGreaterThan(0);
    });

    test('getServerInfo returns server details', () => {
      const info = serverModule.getServerInfo();
      expect(info).not.toBeNull();
      expect(info).toHaveProperty('ip');
      expect(info).toHaveProperty('port');
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
    const wsOpts = () => ({ headers: { origin: 'http://localhost' } });

    afterEach(() => {
      serverModule.setElectronCallback(null);
    });

    test('connects and receives initial state', (done) => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverInfo.port}`, wsOpts());
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
      const ws = new WebSocket(`ws://127.0.0.1:${serverInfo.port}`, wsOpts());
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
      const ws = new WebSocket(`ws://127.0.0.1:${serverInfo.port}`, wsOpts());
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
      const ws1 = new WebSocket(`ws://127.0.0.1:${serverInfo.port}`, wsOpts());
      ws1.on('open', () => {
        const ws2 = new WebSocket(`ws://127.0.0.1:${serverInfo.port}`, wsOpts());
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

    test('rejects connection without valid PIN from non-local origin', (done) => {
      const ws = new WebSocket(`ws://127.0.0.1:${serverInfo.port}?pin=wrong`, {
        headers: { origin: 'http://192.168.1.100' }
      });
      ws.on('close', (code) => {
        expect(code).toBe(4001);
        done();
      });
    });

    test('accepts connection with valid PIN from non-local origin', (done) => {
      const pin = serverModule.getConnectionPin();
      const ws = new WebSocket(`ws://127.0.0.1:${serverInfo.port}?pin=${pin}`, {
        headers: { origin: 'http://192.168.1.100' }
      });
      ws.on('message', (data) => {
        const msg = JSON.parse(data);
        expect(msg).toHaveProperty('type', 'state');
        ws.close();
        done();
      });
    });
  });

  describe('Electron Callback', () => {
    test('receives events via callback', (done) => {
      serverModule.setElectronCallback((action, data) => {
        expect(action).toBe('navigate');
        expect(data).toBe(2);
        serverModule.setElectronCallback(null);
        done();
      });

      const ws = new WebSocket(`ws://127.0.0.1:${serverInfo.port}`, {
        headers: { origin: 'http://localhost' }
      });
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'navigate', slide: 2 }));
        setTimeout(() => ws.close(), 100);
      });
    }, 10000);
  });

  describe('Security', () => {
    test('GET /api/pdf with path traversal returns 404', (done) => {
      http.get(`http://127.0.0.1:${serverInfo.port}/api/pdf/..%2F..%2Fetc%2Fpasswd`, (res) => {
        expect(res.statusCode).toBe(404);
        done();
      });
    });

    test('GET /api/pdf with safe id serves file if it exists', (done) => {
      // Create a dummy PDF in tmpDir
      fs.writeFileSync(path.join(tmpDir, 'testpdf.pdf'), 'dummy');
      http.get(`http://127.0.0.1:${serverInfo.port}/api/pdf/testpdf`, (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toContain('application/pdf');
        res.resume();
        res.on('end', done);
      });
    });

    test('getConnectionPin returns a 6-digit PIN', () => {
      const pin = serverModule.getConnectionPin();
      expect(pin).toMatch(/^\d{6}$/);
    });

    test('QR code URL includes PIN', (done) => {
      http.get(`http://127.0.0.1:${serverInfo.port}/api/qr`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const result = JSON.parse(data);
          expect(result).toHaveProperty('pin');
          expect(result.pin).toMatch(/^\d{6}$/);
          expect(result.url).toContain(`pin=${result.pin}`);
          done();
        });
      });
    });
  });
});
