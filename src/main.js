import { fetchVTR, parseVTR } from './vtr-reader.js?v=20260617-axes';
import Visualization from './visualization.js?v=20260617-axes';

const loadStatus = document.getElementById('load-status');
const meshStatus = document.getElementById('mesh-status');

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function setLoadStatus(text, tone = '') {
  loadStatus.textContent = text;
  loadStatus.className = tone;
}

function setMeshStatus(text) {
  meshStatus.textContent = text;
}

async function boot() {
  const visualization = new Visualization('viewer', {
    controlPanelId: 'control-panel',
    onStatus: setMeshStatus
  });

  try {
    setLoadStatus('Loading final.vtr...');
    const buffer = await fetchVTR('./final.vtr', ({ loaded, total }) => {
      if (total) {
        const pct = Math.round((loaded / total) * 100);
        setLoadStatus(`Loading ${formatBytes(loaded)} / ${formatBytes(total)} (${pct}%)`);
      } else {
        setLoadStatus(`Loading ${formatBytes(loaded)}`);
      }
    });

    setLoadStatus(`Parsing ${formatBytes(buffer.byteLength)}...`);
    const data = parseVTR(buffer, { arrays: ['m'] });
    visualization.updateFromVisData(data);

    const { nx, ny, nz } = data.mesh;
    setLoadStatus(`Loaded ${formatBytes(buffer.byteLength)}`, 'ok');
    setMeshStatus(`Grid ${nx} x ${ny} x ${nz}; ${data.spin.length / 3} magnetization vectors`);
  } catch (error) {
    console.error(error);
    setLoadStatus(error.message || String(error), 'error');
    setMeshStatus('Could not render final.vtr');
  }
}

boot();
