import assert from 'node:assert/strict';
import { ntdFixture } from './ntd-fixture.mjs';
export async function ntdSmoke(api) {
  const initial = await api('/api/ntd-library');
  assert.equal(initial.version, 0);
  await api('/api/ntd-library', {
    overrideHeaders: { 'x-orbit-client': 'invalid' },
    status: 403,
  });
  const file = {
    name: 'registry.xlsx',
    base64: Buffer.from(ntdFixture()).toString('base64'),
  };
  const data = { file, version: 0, confirm: true };
  await api('/api/ntd-library', {
    method: 'POST',
    data: { ...data, confirm: false },
    status: 400,
  });
  await api('/api/ntd-library', {
    method: 'POST',
    data: { ...data, file: {} },
    status: 400,
  });
  const saved = await api('/api/ntd-library', { method: 'POST', data });
  assert.equal(saved.version, 1);
  assert.equal(saved.library.records.length, 1);
  assert.deepEqual(await api('/api/ntd-library'), saved);
  const repeated = await api('/api/ntd-library', {
    method: 'POST',
    data: { ...data, version: 1 },
  });
  assert.equal(repeated.version, 1);
  await api('/api/ntd-library', { method: 'POST', data, status: 409 });
  console.log(
    'PASS: NTD import, read-back, idempotence, validation and stale-version protection.',
  );
}
