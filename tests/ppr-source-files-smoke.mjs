import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, symlink, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export async function sourceFilesSmoke({
  api,
  task,
  library,
  fixture,
  unrelatedId,
  raw,
}) {
  const base = `/api/tasks/${task.id}`,
    path = `${base}/ppr-source-files`;
  const previousFolder = task.workProject.brief.workingFolder;
  const save = async (project, status = 200, revision = task.revision) => {
    const reply = await api(base, {
      method: 'PATCH',
      data: { op: 'edit_work_project', revision, project },
      status,
    });
    if (reply.task) task = reply.task;
    return reply;
  };
  await api(path, { status: 403, overrideHeaders: {} });
  await api(`/api/tasks/${randomUUID()}/ppr-source-files`, { status: 404 });
  await api(`/api/tasks/${unrelatedId}/ppr-source-files`, { status: 409 });
  for (const sourceFolderUrl of [
    'javascript:alert(1)',
    'file:///D:/secret',
    'https://user:pass@example.org',
  ])
    await save({ ...task.workProject, sourceFolderUrl }, 400);
  const url = 'https://example.org/PRIVATE_LINK_DO_NOT_SEND';
  await save(
    { ...task.workProject, sourceFolderUrl: url },
    409,
    task.revision - 1,
  );
  await save({ ...task.workProject, sourceFolderUrl: url });
  assert.equal(task.workProject.sourceFolderUrl, url);
  assert.equal(
    (await api('/api/tasks')).tasks.find((t) => t.id === task.id).workProject
      .sourceFolderUrl,
    url,
  );
  const folder = join(library, 'project'),
    nested = join(folder, 'sources');
  await mkdir(nested, { recursive: true });
  await writeFile(join(nested, 'input.txt'), 'Synthetic local project');
  await writeFile(join(folder, 'volumes.xlsx'), 'Not an actual XLSX');
  const outside = join(fixture, 'outside');
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, 'PRIVATE_OUTSIDE.txt'), 'Not accessible');
  await symlink(
    outside,
    join(folder, 'outside-link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const setFolder = (workingFolder) =>
    save({
      ...task.workProject,
      brief: { ...task.workProject.brief, workingFolder },
    });
  await setFolder(folder);
  const listing = await api(path);
  assert.equal(listing.enabled, true);
  assert.equal(listing.configured, true);
  assert.ok(
    listing.items.some((i) => i.name === 'sources' && i.kind === 'directory'),
  );
  assert.ok(
    listing.items.some((i) => i.name === 'volumes.xlsx'),
    'Unsupported formats must remain visible.',
  );
  assert.ok(!listing.items.some((i) => i.name === 'outside-link'));
  assert.equal(listing.unavailable, 1);
  const files = await api(`${path}?path=sources`);
  assert.equal(files.items[0].downloadPath, 'project/sources/input.txt');
  // Real filesystem fixture: repeated parsing must not rewrite the original
  // or create adjacent copies. The read endpoints reject write methods.
  const originalPath = join(nested, 'input.txt');
  const originalBytes = await readFile(originalPath);
  const originalStat = await stat(originalPath);
  const namesBefore = await readdir(nested);
  const readPath = '/api/work-files/download?path=project%2Fsources%2Finput.txt';
  for (const endpoint of [readPath, path]) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await raw(endpoint, { method });
      assert.equal(response.status, 405, `${method} must not modify source files`);
      await response.text();
    }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await raw(readPath);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), originalBytes);
    await api(`${base}/ppr-workspace`, {
      method: 'POST',
      data: { op: 'inspect', revision: task.revision,
        file: { name: 'input.txt', base64: originalBytes.toString('base64') } },
    });
  }
  assert.deepEqual(await readFile(originalPath), originalBytes);
  assert.equal((await stat(originalPath)).mtimeMs, originalStat.mtimeMs);
  assert.deepEqual(await readdir(nested), namesBefore);
  await api(`${path}?path=..%2F`, { status: 403 });
  await api(`${path}?path=outside-link`, { status: 403 });
  await setFolder(outside);
  await api(path, { status: 403 });
  await setFolder('project/sources/input.txt');
  await api(path, { status: 400 });
  await setFolder('project');
  assert.equal((await api(path)).folderName, 'project');
  await setFolder('');
  assert.equal((await api(path)).configured, false);
  await setFolder(previousFolder);
  return task;
}
