import fs from 'node:fs';

export async function openWorkspace(page, root) {
  const health = await page.request.get('http://localhost:3000/api/health');
  if (!health.ok()) throw Error('Start the local app before browser checks.');
  const {auth_mode: mode} = await health.json();
  await page.goto('http://localhost:3000');
  if (mode === 'account') {
    const credentials = JSON.parse(fs.readFileSync(root + '/data/local-admin.json', 'utf8'));
    await page.getByLabel('Work email').fill(credentials.email);
    await page.getByLabel('Password', {exact: true}).fill(credentials.password);
    await page.getByRole('button', {name: /^Sign in/}).click();
  } else if (mode !== 'local') throw Error('Unknown workspace access mode');
  await page.getByRole('heading', {name: /Follow the law/}).waitFor();
  const logo = page.getByRole('img', {name: 'Lex Raptor', exact: true});
  await logo.waitFor();
  if (!(await logo.evaluate(img => img.complete && img.naturalWidth > 0))) throw Error('Logo did not load');
  if (mode === 'local') {
    if (await page.getByLabel('Password', {exact: true}).count()) throw Error('Local workspace still requires login');
    if (await page.getByRole('button', {name: 'Sign out', exact: true}).count()) throw Error('Local workspace still shows account controls');
    if ((await page.context().cookies()).some(c => c.name.startsWith('defense_'))) throw Error('Local access created an auth cookie');
    const invitation = await page.request.post('http://localhost:3000/api/admin/invitations', {
      headers: {Origin: 'http://localhost:3000'}, data: {email: 'nobody@example.test'}
    });
    if (invitation.status() !== 409) throw Error('Local mode exposes account invitations');
  }
  return mode;
}
