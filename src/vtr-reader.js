const TEXT_DECODER = new TextDecoder('utf-8');

export async function fetchVTR(url, onProgress = null) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }

  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onProgress?.({ loaded: buffer.byteLength, total });
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.({ loaded, total });
  }

  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

export function parseVTR(buffer, options = {}) {
  const bytes = new Uint8Array(buffer);
  const appendedTagIndex = findAscii(bytes, '<AppendedData');
  if (appendedTagIndex < 0) {
    throw new Error('VTR parser only supports appended raw data files.');
  }

  const tagEnd = findByte(bytes, '>'.charCodeAt(0), appendedTagIndex);
  const rawMarker = findByte(bytes, '_'.charCodeAt(0), tagEnd + 1);
  if (tagEnd < 0 || rawMarker < 0) {
    throw new Error('Could not locate VTR appended raw data marker.');
  }

  const xmlText = TEXT_DECODER.decode(bytes.subarray(0, rawMarker));
  const headerType = readAttr(xmlText, /<VTKFile\b[^>]*>/, 'header_type') || 'UInt32';
  const byteOrder = readAttr(xmlText, /<VTKFile\b[^>]*>/, 'byte_order') || 'LittleEndian';
  const littleEndian = byteOrder !== 'BigEndian';
  const extentText = readAttr(xmlText, /<RectilinearGrid\b[^>]*>/, 'WholeExtent');
  if (!extentText) {
    throw new Error('Missing RectilinearGrid WholeExtent.');
  }

  const extent = extentText.trim().split(/\s+/).map(Number);
  if (extent.length !== 6 || extent.some((value) => !Number.isFinite(value))) {
    throw new Error(`Invalid WholeExtent: ${extentText}`);
  }

  const nx = extent[1] - extent[0] + 1;
  const ny = extent[3] - extent[2] + 1;
  const nz = extent[5] - extent[4] + 1;
  const pointCount = nx * ny * nz;
  const dataArrays = parseDataArrayTags(xmlText);
  const wanted = new Set(options.arrays || ['m']);

  const x = readNamedArray('x_coordinates', nx);
  const y = readNamedArray('y_coordinates', ny);
  const z = readNamedArray('z_coordinates', nz);
  const spin = wanted.has('m') ? readNamedArray('m', pointCount * 3, true) : null;
  if (!spin) {
    throw new Error('Missing required PointData array "m".');
  }

  const dimensions = [
    Math.abs(x[x.length - 1] - x[0]) || Math.max(1, nx - 1),
    Math.abs(y[y.length - 1] - y[0]) || Math.max(1, ny - 1),
    Math.abs(z[z.length - 1] - z[0]) || Math.max(1, nz - 1)
  ];
  const spacing = [
    dimensions[0] / Math.max(1, nx - 1),
    dimensions[1] / Math.max(1, ny - 1),
    dimensions[2] / Math.max(1, nz - 1)
  ];

  return {
    mesh: {
      type: 'fd',
      nx,
      ny,
      nz,
      dx: spacing[0],
      dy: spacing[1],
      dz: spacing[2],
      dimensions
    },
    coordinates: { x, y, z },
    arrays: { m: spin },
    spin
  };

  function readNamedArray(name, expectedValues, asFloat32 = false) {
    const meta = dataArrays.find((array) => array.Name === name);
    if (!meta) {
      throw new Error(`Missing DataArray "${name}".`);
    }
    if (meta.format !== 'appended') {
      throw new Error(`DataArray "${name}" is not appended format.`);
    }
    if (meta.type !== 'Float64') {
      throw new Error(`DataArray "${name}" has unsupported type "${meta.type}".`);
    }

    const blockOffset = rawMarker + 1 + Number(meta.offset);
    const headerBytes = headerType === 'UInt64' ? 8 : 4;
    const view = new DataView(buffer);
    const byteLength = headerType === 'UInt64'
      ? Number(view.getBigUint64(blockOffset, littleEndian))
      : view.getUint32(blockOffset, littleEndian);
    const valueCount = byteLength / Float64Array.BYTES_PER_ELEMENT;
    if (valueCount < expectedValues) {
      throw new Error(`DataArray "${name}" has ${valueCount} values; expected ${expectedValues}.`);
    }

    const payloadOffset = blockOffset + headerBytes;
    if (asFloat32) {
      return readFloat64AsFloat32(buffer, payloadOffset, expectedValues, littleEndian);
    }
    return readFloat64Array(buffer, payloadOffset, expectedValues, littleEndian);
  }
}

function readFloat64Array(buffer, byteOffset, count, littleEndian) {
  if (littleEndian && byteOffset % Float64Array.BYTES_PER_ELEMENT === 0) {
    return new Float64Array(buffer, byteOffset, count);
  }

  const view = new DataView(buffer, byteOffset, count * Float64Array.BYTES_PER_ELEMENT);
  const values = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    values[i] = view.getFloat64(i * Float64Array.BYTES_PER_ELEMENT, littleEndian);
  }
  return values;
}

function readFloat64AsFloat32(buffer, byteOffset, count, littleEndian) {
  if (littleEndian && byteOffset % Float64Array.BYTES_PER_ELEMENT === 0) {
    return Float32Array.from(new Float64Array(buffer, byteOffset, count));
  }

  const view = new DataView(buffer, byteOffset, count * Float64Array.BYTES_PER_ELEMENT);
  const values = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    values[i] = view.getFloat64(i * Float64Array.BYTES_PER_ELEMENT, littleEndian);
  }
  return values;
}

function parseDataArrayTags(xmlText) {
  const tags = xmlText.match(/<DataArray\b[^>]*\/>/g) || [];
  return tags.map((tag) => {
    const attrs = {};
    for (const match of tag.matchAll(/([\w:.-]+)="([^"]*)"/g)) {
      attrs[match[1]] = match[2];
    }
    return attrs;
  });
}

function readAttr(xmlText, tagPattern, attrName) {
  const tag = xmlText.match(tagPattern)?.[0];
  if (!tag) return null;
  return tag.match(new RegExp(`${attrName}="([^"]*)"`))?.[1] || null;
}

function findAscii(bytes, text) {
  const pattern = new TextEncoder().encode(text);
  outer:
  for (let i = 0; i <= bytes.length - pattern.length; i += 1) {
    for (let j = 0; j < pattern.length; j += 1) {
      if (bytes[i + j] !== pattern[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function findByte(bytes, byte, start) {
  for (let i = start; i < bytes.length; i += 1) {
    if (bytes[i] === byte) return i;
  }
  return -1;
}
