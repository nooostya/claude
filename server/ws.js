// A small RFC 6455 WebSocket server implementation.
//
// The game ships with no npm dependencies, so rather than pulling in `ws` this
// handles the handshake and frame codec directly. It supports what the game
// needs: text frames, fragmentation, ping/pong and close.

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 1 << 20;   // 1 MiB; game messages are a few hundred bytes

const OP = { CONT: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

export class WebSocketConnection extends EventEmitter {
  constructor(socket, req) {
    super();
    this.socket = socket;
    this.req = req;
    this.open = true;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOp = null;
    this.isAlive = true;

    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => this._shutdown());
    socket.on('error', (err) => { this.emit('error', err); this._shutdown(); });
    socket.setNoDelay(true);
  }

  get remoteAddress() {
    return this.req.socket.remoteAddress;
  }

  _shutdown() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }

  _onData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (this.open) {
      const frame = this._readFrame();
      if (!frame) break;
      this._handleFrame(frame);
    }
  }

  /** Pull one complete frame out of the buffer, or null if more bytes are needed. */
  _readFrame() {
    const b = this.buffer;
    if (b.length < 2) return null;

    const b0 = b[0], b1 = b[1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = 2;

    if (len === 126) {
      if (b.length < offset + 2) return null;
      len = b.readUInt16BE(offset);
      offset += 2;
    } else if (len === 127) {
      if (b.length < offset + 8) return null;
      const big = b.readBigUInt64BE(offset);
      if (big > BigInt(MAX_PAYLOAD)) { this.close(1009, 'message too big'); return null; }
      len = Number(big);
      offset += 8;
    }
    if (len > MAX_PAYLOAD) { this.close(1009, 'message too big'); return null; }

    let mask = null;
    if (masked) {
      if (b.length < offset + 4) return null;
      mask = b.subarray(offset, offset + 4);
      offset += 4;
    }
    if (b.length < offset + len) return null;

    const payload = Buffer.from(b.subarray(offset, offset + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];

    this.buffer = b.subarray(offset + len);
    return { fin, opcode, payload };
  }

  _handleFrame(frame) {
    switch (frame.opcode) {
      case OP.PING:
        this._send(OP.PONG, frame.payload);
        break;
      case OP.PONG:
        this.isAlive = true;
        break;
      case OP.CLOSE:
        this.close(1000);
        break;
      case OP.TEXT:
      case OP.BINARY:
        if (frame.fin) {
          this._deliver(frame.opcode, frame.payload);
        } else {
          this.fragmentOp = frame.opcode;
          this.fragments = [frame.payload];
        }
        break;
      case OP.CONT:
        if (this.fragmentOp == null) break;
        this.fragments.push(frame.payload);
        if (frame.fin) {
          this._deliver(this.fragmentOp, Buffer.concat(this.fragments));
          this.fragments = [];
          this.fragmentOp = null;
        }
        break;
    }
  }

  _deliver(opcode, payload) {
    this.isAlive = true;
    if (opcode === OP.TEXT) this.emit('message', payload.toString('utf8'));
    else this.emit('binary', payload);
  }

  _send(opcode, payload) {
    if (!this.open || this.socket.destroyed) return false;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.allocUnsafe(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.allocUnsafe(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.allocUnsafe(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;     // FIN + opcode, server frames are unmasked
    try {
      this.socket.write(Buffer.concat([header, payload]));
      return true;
    } catch {
      this._shutdown();
      return false;
    }
  }

  send(text) {
    return this._send(OP.TEXT, Buffer.from(text, 'utf8'));
  }

  sendJson(obj) {
    return this.send(JSON.stringify(obj));
  }

  ping() {
    this.isAlive = false;
    this._send(OP.PING, Buffer.alloc(0));
  }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2);
    this._send(OP.CLOSE, payload);
    this.open = false;
    try { this.socket.end(); } catch { /* already gone */ }
    this.emit('close');
  }
}

/** Attach WebSocket upgrade handling to a plain node:http server. */
export function attachWebSocket(httpServer, onConnection) {
  httpServer.on('upgrade', (req, socket, head) => {
    const key = req.headers['sec-websocket-key'];
    const upgrade = (req.headers.upgrade || '').toLowerCase();
    if (upgrade !== 'websocket' || !key) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const conn = new WebSocketConnection(socket, req);
    if (head && head.length) conn._onData(head);
    onConnection(conn, req);
  });
}
