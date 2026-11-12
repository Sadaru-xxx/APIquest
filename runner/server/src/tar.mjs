// ソースファイルをサンドボックスへ渡すための最小限の tar(ustar)作成
export function makeTar(entries) {
  const parts = [];
  const mtime = Math.floor(Date.now() / 1000);
  for (const { name, data } of entries) {
    if (Buffer.byteLength(name) > 100) throw new Error('tar entry name too long');
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, 'utf8');
    h.write('0000644\0', 100);
    h.write('0000000\0', 108);
    h.write('0000000\0', 116);
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write(mtime.toString(8).padStart(11, '0') + '\0', 136);
    h.write('        ', 148);
    h.write('0', 156);
    h.write('ustar\0', 257);
    h.write('00', 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    parts.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
