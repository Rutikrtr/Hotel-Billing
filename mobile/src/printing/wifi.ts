// Wi-Fi / LAN thermal printers: ESC/POS bytes straight to the printer's port (usually 9100) on the same network.
import { Buffer } from 'buffer';
import TcpSocket from 'react-native-tcp-socket';

/** "192.168.1.50" or "192.168.1.50:9100" → host and port. */
export function parseAddress(text: string): { host: string; port: number } {
  const m = text.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{2,5}))?$/);
  if (!m || m[1].split('.').some((n) => Number(n) > 255)) throw new Error('Enter the printer’s IP address, like 192.168.1.50 (find it on the printer’s self-test slip).');
  return { host: m[1], port: m[2] ? Number(m[2]) : 9100 };
}

/** Send bytes and close. Gives up after 8 s with a clear message. */
export function printTcp(address: string, data: Uint8Array): Promise<void> {
  const { host, port } = parseAddress(address);
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch { /* closed */ }
      if (err) reject(err); else resolve();
    };
    const timer = setTimeout(() => finish(new Error(`Wi-Fi printer ${host} didn’t answer. Check it is on and this phone is on the same Wi-Fi.`)), 8000);
    const socket = TcpSocket.createConnection({ host, port }, () => {
      socket.write(Buffer.from(data), undefined, (err) => {
        if (err) return finish(err instanceof Error ? err : new Error(String(err)));
        // Let the printer read everything before the connection closes.
        setTimeout(() => finish(), 400);
      });
    });
    socket.on('error', (err) => finish(new Error(`Wi-Fi printer ${host}: ${err?.message ?? 'connection failed'}`)));
  });
}
