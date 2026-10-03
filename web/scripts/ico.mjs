// Windows .ico files, written and read without a native tool. Every entry is a
// PNG (allowed since Vista, and what electron-builder itself produces), so
// one vector render per size is all an icon needs. ICONDIR, then one
// ICONDIRENTRY per image, then the image data back to back:
// https://learn.microsoft.com/en-us/previous-versions/ms997538(v=msdn.10)
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;

// Width and height of a PNG from its IHDR chunk, which always comes first.
export function pngSize(data) {
  const png = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE) || png.toString('latin1', 12, 16) !== 'IHDR') {
    throw new TypeError('Not a PNG image');
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

// `images` are PNG buffers of square icons, each at most 256 px.
export function buildIco(images) {
  if (images.length === 0 || images.length > 0xffff) throw new RangeError(`An icon holds 1 to 65535 images, not ${images.length}`);
  const header = Buffer.alloc(HEADER_BYTES + ENTRY_BYTES * images.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon, 2 = cursor
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  const blobs = images.map((data, index) => {
    const png = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const { width, height } = pngSize(png);
    if (width !== height || width < 1 || width > 256) throw new RangeError(`Icon images are square and at most 256 px, not ${width}×${height}`);
    const entry = HEADER_BYTES + ENTRY_BYTES * index;
    header[entry] = width === 256 ? 0 : width; // 0 stands for 256
    header[entry + 1] = height === 256 ? 0 : height;
    header[entry + 2] = 0; // colour count: none, true colour
    header[entry + 3] = 0; // reserved
    header.writeUInt16LE(1, entry + 4); // colour planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
    return png;
  });
  return Buffer.concat([header, ...blobs]);
}

// The directory of an existing .ico: [{ width, height, bytes, offset, png }].
export function readIco(data) {
  const ico = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (ico.length < HEADER_BYTES || ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) throw new TypeError('Not an icon file');
  const count = ico.readUInt16LE(4);
  const entries = [];
  for (let index = 0; index < count; index++) {
    const entry = HEADER_BYTES + ENTRY_BYTES * index;
    if (entry + ENTRY_BYTES > ico.length) throw new RangeError('Icon directory is truncated');
    const bytes = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    if (offset + bytes > ico.length) throw new RangeError(`Icon image ${index} runs past the end of the file`);
    const image = ico.subarray(offset, offset + bytes);
    const png = image.length >= 8 && image.subarray(0, 8).equals(PNG_SIGNATURE);
    entries.push({ width: ico[entry] || 256, height: ico[entry + 1] || 256, bytes, offset, png, image });
  }
  return entries;
}
